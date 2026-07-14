import { mkdir, cp, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diagnose } from './diagnose.js';
import { captureBrowser, emptyCapture } from './browser-capture.js';
import { compareCaptures, score } from './compare.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

const SECRET_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  'credentials.json',
  'service-account.json',
]);

/**
 * Runs one full TraceFix debugging session.
 * @param {object} input
 * @param {(step) => Promise<void>|void} onStep
 */
export async function runDebugSession(input, onStep = async () => {}) {
  const {
    sessionId,
    projectPath,
    errorDescription,
    appUrl = '',
    openBranch = true,
    runTests = true,
    skipBrowser = false,
    maxFixAttempts = Number(process.env.MAX_FIX_ATTEMPTS || 2),
    cancelState = null,
    pushRemote = Boolean(process.env.GITHUB_TOKEN),
    sourceType = 'local',
    repoFullName = '',
    baseBranch = 'main',
    githubToken = '',
    openPr = false,
  } = input;

  const sandboxBase = process.env.SANDBOX_DIR || '.tracefix-sandboxes';
  const sandboxRoot = resolve(ROOT, sandboxBase, sessionId);
  const workDir = join(sandboxRoot, 'work');
  const readyTimeout = Number(process.env.APP_READY_TIMEOUT_MS || 60_000);
  const sandboxMaxCount = Number(process.env.SANDBOX_MAX_COUNT ?? 20);
  const cleanupOnComplete = String(process.env.SANDBOX_CLEANUP_ON_COMPLETE || 'false').toLowerCase() === 'true';
  const isGithub = sourceType === 'github';

  // Drop oldest sandboxes so 100 runs don't leave 100 full project copies on disk.
  await pruneSandboxes(resolve(ROOT, sandboxBase), {
    keepLast: sandboxMaxCount,
    keepIds: new Set([sessionId]),
  });

  await rm(sandboxRoot, { recursive: true, force: true });
  await mkdir(sandboxRoot, { recursive: true });

  if (isGithub) {
    if (!githubToken) throw new Error('GitHub token missing — connect GitHub in TraceFix first.');
    if (!repoFullName) throw new Error('repoFullName is required for GitHub sessions.');
    await rm(workDir, { recursive: true, force: true });
    const { shallowCloneRepo } = await import('./github.js');
    await shallowCloneRepo({
      workDir,
      repoFullName,
      branch: baseBranch || 'main',
      token: githubToken,
      depth: 1,
    });
  } else {
    await mkdir(workDir, { recursive: true });
    const source = resolve(projectPath);
    const sourceStat = await stat(source).catch(() => null);
    if (!sourceStat?.isDirectory()) {
      throw new Error(`Project path is not a directory: ${source}`);
    }
    try {
      await readFile(join(source, 'package.json'), 'utf8');
    } catch {
      throw new Error(
        `No package.json in project root: ${source}. Point TraceFix at the app folder that contains package.json (not src/, not a sandbox copy).`,
      );
    }

    const SKIP_COPY = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'coverage']);
    await cp(source, workDir, {
      recursive: true,
      filter: (src) => {
        const rel = relative(source, src);
        if (!rel || rel === '') return true;
        const parts = rel.split(/[/\\]/);
        return !parts.some((part) => SKIP_COPY.has(part));
      },
    });

    try {
      await readFile(join(workDir, 'package.json'), 'utf8');
    } catch {
      throw new Error(
        `Sandbox copy is missing package.json (source=${source}). Check the project path and that the folder is readable.`,
      );
    }

    try {
      await cp(join(source, '.git'), join(workDir, '.git'), { recursive: true });
    } catch {
      await git(['init'], workDir).catch(() => null);
      await git(['config', 'user.email', 'tracefix@local'], workDir).catch(() => null);
      await git(['config', 'user.name', 'TraceFix'], workDir).catch(() => null);
      await git(['add', '-A'], workDir).catch(() => null);
      await git(['commit', '-m', 'tracefix: sandbox snapshot'], workDir).catch(() => null);
    }
  }

  try {
    await readFile(join(workDir, 'package.json'), 'utf8');
  } catch {
    throw new Error(
      isGithub
        ? `Cloned repo ${repoFullName} has no package.json at root.`
        : 'Sandbox work tree is missing package.json.',
    );
  }

  // Keep runtime .env for the target app, but never search/log secret files.
  await scrubCopiedSecrets(workDir);

  const ctx = {
    sessionId,
    workDir,
    sandboxRoot,
    errorDescription,
    appUrl: String(appUrl || '').trim(),
    managedServer: null,
    projectType: null,
  };

  if (cancelState) {
    cancelState.kill = async () => {
      if (ctx.managedServer) await stopProcess(ctx.managedServer).catch(() => null);
    };
  }

  const result = {
    ok: true,
    sessionId,
    steps: [],
    diagnosis: null,
    verify: null,
    branch: null,
    tests: null,
    attempts: 0,
    pushed: null,
    pullRequest: null,
    sourceType: isGithub ? 'github' : 'local',
    repoFullName: isGithub ? repoFullName : null,
  };

  async function step(id, status, logs, data) {
    assertNotCancelled(cancelState);
    const entry = {
      id,
      status,
      logs: redactSecrets(logs),
      data: data ?? null,
      at: new Date().toISOString(),
    };
    const existing = result.steps.findIndex((s) => s.id === id);
    if (existing >= 0) result.steps[existing] = entry;
    else result.steps.push(entry);
    await onStep(entry);
  }

  try {
    ctx.projectType = await detectProject(workDir);

    const hasEnv = await sandboxHasEnvFile(workDir);
    let browserSkipped = Boolean(skipBrowser);
    let browserSkipReason = skipBrowser
      ? 'Browser capture skipped by user'
      : null;
    let beforeUrl = ctx.appUrl;
    let before = emptyCapture(beforeUrl || '');

    // --- Run app / resolve URL (never hard-fail the whole session) ---
    if (browserSkipped) {
      await step('run_app', 'completed', browserSkipReason, {
        skipped: true,
        hasEnv,
      });
    } else if (beforeUrl) {
      const alive = await assertHttpAlive(beforeUrl, 12_000);
      if (!alive) {
        browserSkipped = true;
        browserSkipReason = `App URL not responding (${beforeUrl}) — continuing with code/git diagnosis`;
        await step('run_app', 'completed', browserSkipReason, {
          skipped: true,
          appUrl: beforeUrl,
          hasEnv,
        });
        beforeUrl = '';
      } else {
        await step('run_app', 'completed', `Using provided URL ${beforeUrl}`, {
          url: beforeUrl,
          hasEnv,
        });
      }
    } else if (!hasEnv) {
      browserSkipped = true;
      browserSkipReason =
        'No .env in sandbox (typical for GitHub clones) — skipped app start & browser; continuing with code/git diagnosis';
      await step('run_app', 'completed', browserSkipReason, {
        skipped: true,
        hasEnv: false,
        hint: 'Paste a running App URL, or add sandbox env secrets, to enable browser capture',
      });
    } else {
      try {
        await step('run_app', 'running', 'Installing dependencies…');
        await installDeps(workDir, ctx.projectType.packageManager);
        await step('run_app', 'running', 'Starting server…');
        const server = await startServer(workDir, ctx.projectType.packageManager, readyTimeout);
        ctx.managedServer = server;
        beforeUrl = server.url;
        const alive = await assertHttpAlive(beforeUrl, 12_000);
        if (!alive) {
          await stopProcess(ctx.managedServer).catch(() => null);
          ctx.managedServer = null;
          browserSkipped = true;
          browserSkipReason = `App started but stopped responding at ${beforeUrl} — continuing without browser`;
          await step('run_app', 'completed', browserSkipReason, {
            skipped: true,
            url: beforeUrl,
            hasEnv,
          });
          beforeUrl = '';
        } else {
          await step('run_app', 'completed', `App ready at ${beforeUrl}`, {
            url: beforeUrl,
            hasEnv,
          });
        }
      } catch (err) {
        if (ctx.managedServer) {
          await stopProcess(ctx.managedServer).catch(() => null);
          ctx.managedServer = null;
        }
        browserSkipped = true;
        browserSkipReason = `Could not start app (${err.message}) — continuing with code/git diagnosis`;
        await step('run_app', 'completed', browserSkipReason, {
          skipped: true,
          hasEnv,
          startError: err.message,
        });
        beforeUrl = '';
      }
    }

    // --- Browser capture (console + network) ---
    if (browserSkipped || !beforeUrl) {
      before = emptyCapture(beforeUrl || '');
      const reason = browserSkipReason || 'Browser capture skipped';
      await step('console', 'completed', reason, { skipped: true });
      await step('network', 'completed', reason, { skipped: true });
    } else {
      try {
        await step('console', 'running', 'Opening browser…');
        const stillAlive = await assertHttpAlive(beforeUrl, 8_000);
        if (!stillAlive) {
          throw new Error(`App hung before browser capture (${beforeUrl})`);
        }
        before = await captureBrowser({
          url: beforeUrl,
          screenshotPath: join(sandboxRoot, 'before.png'),
        });
        if (before.navigationError) {
          await step(
            'console',
            'completed',
            `Browser navigation issue: ${before.navigationError}`,
            { summary: before.summary, navigationError: before.navigationError },
          );
        } else {
          await step(
            'console',
            'completed',
            `${before.summary.consoleErrors} console errors, ${before.summary.pageErrors} page errors`,
            { summary: before.summary, pageErrors: before.pageErrors.slice(0, 8) },
          );
        }
        await step(
          'network',
          'completed',
          `${before.summary.failedRequests} failed HTTP, ${before.summary.networkErrors} network errors`,
          {
            failedRequests: before.failedRequests.slice(0, 10),
            networkErrors: before.networkErrors.slice(0, 8),
          },
        );
      } catch (err) {
        browserSkipped = true;
        browserSkipReason = `${err.message} — continuing with code/git diagnosis`;
        before = emptyCapture(beforeUrl || '');
        await step('console', 'completed', browserSkipReason, { skipped: true });
        await step('network', 'completed', browserSkipReason, { skipped: true });
      }
    }

    const gitLog = await readGitLog(workDir);
    await step('git_history', 'completed', gitLog.log || 'No git history available', {
      commits: gitLog.commits,
    });

    const search = await searchCode(workDir, errorDescription);
    await step('root_cause', 'running', 'Diagnosing with LLM…');
    let diagnosis = await diagnose({
      errorDescription,
      projectType: ctx.projectType,
      gitLog: gitLog.log,
      search,
      capture: before,
    });
    result.diagnosis = diagnosis;
    result.attempts = 1;

    await step('root_cause', 'completed', diagnosis.rootCause, {
      summary: diagnosis.summary,
      confidence: diagnosis.confidence,
      evidence: diagnosis.evidence,
      provider: diagnosis.provider,
    });
    await step(
      'suggest_fix',
      'completed',
      diagnosis.suggestedFiles.length
        ? `Suggested ${diagnosis.suggestedFiles.length} file(s)`
        : 'Report-only suggestion (no file patches)',
      { files: diagnosis.suggestedFiles.map((f) => f.path), provider: diagnosis.provider },
    );

    let branch = null;
    if (openBranch) {
      branch = await applyFixBranch(workDir, sessionId, diagnosis);
      result.branch = branch;
      await step('apply_branch', 'completed', `Changes on branch ${branch}`, {
        branch,
        files: diagnosis.suggestedFiles.map((f) => f.path),
        attempt: 1,
      });

      const shouldPush = isGithub ? Boolean(githubToken) : pushRemote;
      if (shouldPush && branch) {
        try {
          if (isGithub) {
            const { pushBranch, createPullRequest } = await import('./github.js');
            await pushBranch({
              workDir,
              repoFullName,
              branch,
              token: githubToken,
              message: diagnosis.summary,
            });
            result.pushed = { ok: true, branch };
            await step('apply_branch', 'completed', `Pushed ${branch} to GitHub`, {
              branch,
              pushed: true,
              repoFullName,
            });

            if (openPr) {
              const pr = await createPullRequest({
                token: githubToken,
                repoFullName,
                title: `fix(tracefix): ${String(diagnosis.summary || errorDescription).slice(0, 72)}`,
                body: [
                  '## TraceFix automated fix',
                  '',
                  diagnosis.reportMarkdown || diagnosis.rootCause || '',
                  '',
                  `_Opened by TraceFix — review carefully before merge._`,
                ].join('\n'),
                head: branch,
                base: baseBranch || 'main',
              });
              result.pullRequest = pr;
              await step('apply_branch', 'completed', `Opened PR #${pr.number}`, {
                branch,
                prUrl: pr.htmlUrl,
                prNumber: pr.number,
              });
            }
          } else {
            const pushed = await tryPushBranch(workDir, branch);
            result.pushed = pushed;
            if (pushed.ok) {
              await step('apply_branch', 'completed', `Pushed ${branch} to remote`, {
                branch,
                pushed: true,
              });
            }
          }
        } catch (err) {
          result.pushed = { ok: false, reason: err.message };
          await step('apply_branch', 'completed', `Local branch ready; push/PR failed: ${err.message}`, {
            branch,
            pushError: err.message,
          });
        }
      }
    } else {
      await step('apply_branch', 'completed', 'Branch step skipped by user', { skipped: true });
    }

    let tests = null;
    if (runTests) {
      tests = await runProjectTests(workDir, ctx.projectType.packageManager);
      result.tests = tests;
      await step(
        'run_tests',
        tests.skipped ? 'completed' : tests.ok ? 'completed' : 'failed',
        tests.skipped ? `Skipped: ${tests.reason}` : tests.ok ? 'Tests passed' : 'Tests failed',
        tests,
      );
    } else {
      await step('run_tests', 'completed', 'Tests skipped by user', { skipped: true });
    }

    let after = before;
    let verify = null;
    const attempts = Math.max(1, Number(maxFixAttempts) || 1);
    const hadPatches = Boolean(diagnosis.suggestedFiles?.length);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      assertNotCancelled(cancelState);
      await step('confirm', 'running', `Confirming fix (attempt ${attempt}/${attempts})…`);

      if (browserSkipped || !beforeUrl) {
        after = emptyCapture(beforeUrl || '');
        verify = compareCaptures(before, after, errorDescription, diagnosis.suggestedFiles);
        verify.status = 'skipped';
        verify.notes = [
          ...(verify.notes || []),
          browserSkipReason || 'Browser confirm skipped',
          diagnosis.suggestedFiles?.length
            ? `Applied ${diagnosis.suggestedFiles.length} file patch(es).`
            : 'No file patches applied.',
        ];
        break;
      }

      // Only restart when we applied patches; otherwise re-check the already-running app.
      if (ctx.managedServer && (hadPatches || attempt > 1)) {
        await step('confirm', 'running', 'Restarting app for verify…');
        await stopProcess(ctx.managedServer);
        ctx.managedServer = null;
        await waitForPortFree(4318, 20_000);
        try {
          ctx.managedServer = await startServer(
            workDir,
            ctx.projectType.packageManager,
            readyTimeout,
          );
          beforeUrl = ctx.managedServer.url;
          await warmUpUrl(beforeUrl, 45_000);
        } catch (err) {
          verify = {
            status: 'inconclusive',
            before: score(before),
            after: score(null),
            delta: 0,
            notes: [
              `Could not restart app for confirm: ${err.message}`,
              'Diagnosis and branch (if any) were kept; verify was skipped.',
            ],
          };
          break;
        }
      }

      const alive = await assertHttpAlive(beforeUrl, 20_000);
      if (!alive) {
        verify = {
          status: 'inconclusive',
          before: score(before),
          after: score(null),
          delta: 0,
          notes: [
            `App hung during confirm at ${beforeUrl}`,
            'Diagnosis and branch (if any) were kept; live verify could not finish.',
          ],
        };
        break;
      }

      try {
        after = await captureBrowser({
          url: beforeUrl,
          screenshotPath: join(sandboxRoot, `after-${attempt}.png`),
        });
      } catch (err) {
        verify = {
          status: 'inconclusive',
          before: score(before),
          after: score(null),
          delta: 0,
          notes: [
            `Browser confirm failed: ${err.message}`,
            'Diagnosis and branch (if any) were kept.',
          ],
        };
        break;
      }

      verify = compareCaptures(before, after, errorDescription, diagnosis.suggestedFiles);
      result.verify = verify;
      result.attempts = attempt;

      const good = verify.status === 'resolved' || verify.status === 'improved';
      if (good || attempt >= attempts || !openBranch) break;

      await step(
        'confirm',
        'completed',
        `Verify ${verify.status} — retrying fix (attempt ${attempt + 1}/${attempts})`,
        { ...verify, retrying: true },
      );

      diagnosis = await diagnose({
        errorDescription,
        projectType: ctx.projectType,
        gitLog: gitLog.log,
        search,
        capture: after,
        priorNotes: [
          `Previous verify: ${verify.status}`,
          ...(verify.notes || []),
          `Attempt ${attempt} patches: ${(diagnosis.suggestedFiles || []).map((f) => f.path).join(', ') || 'none'}`,
        ],
      });
      result.diagnosis = diagnosis;

      if (!diagnosis.suggestedFiles?.length) break;

      branch = await applyFixBranch(workDir, sessionId, diagnosis, { reuseBranch: branch });
      result.branch = branch;
      await step('apply_branch', 'completed', `Retry patches on ${branch}`, {
        branch,
        files: diagnosis.suggestedFiles.map((f) => f.path),
        attempt: attempt + 1,
      });
    }

    result.verify = verify;
    await step(
      'confirm',
      verify?.status === 'inconclusive' ? 'failed' : 'completed',
      `Verify status: ${verify?.status || 'unknown'} (${verify?.before?.total ?? 0} → ${verify?.after?.total ?? 0})`,
      verify,
    );

    result.ok = true;
    result.sandboxPath = sandboxRoot;
    return result;
  } catch (error) {
    result.ok = false;
    result.error = error.message;
    result.sandboxPath = sandboxRoot;
    const cancelled = /cancelled/i.test(error.message);
    await step(cancelled ? 'confirm' : 'confirm', cancelled ? 'failed' : 'failed', error.message);
    throw error;
  } finally {
    if (ctx.managedServer) {
      await stopProcess(ctx.managedServer).catch(() => null);
    }
    if (cancelState) cancelState.kill = null;

    if (cleanupOnComplete) {
      await rm(sandboxRoot, { recursive: true, force: true }).catch(() => null);
      result.sandboxPath = null;
      result.sandboxCleaned = true;
    } else {
      await pruneSandboxes(resolve(ROOT, sandboxBase), {
        keepLast: sandboxMaxCount,
        keepIds: new Set([sessionId]),
      }).catch(() => null);
    }
  }
}

/**
 * Keep only the newest N sandbox folders. Session metadata stays in MongoDB.
 * @param {string} baseDir
 * @param {{ keepLast?: number, keepIds?: Set<string> }} opts
 */
export async function pruneSandboxes(baseDir, { keepLast = 20, keepIds = new Set() } = {}) {
  if (!Number.isFinite(keepLast) || keepLast < 0) return { removed: [] };
  // 0 = unlimited
  if (keepLast === 0) return { removed: [] };

  let entries;
  try {
    entries = await readdir(baseDir, { withFileTypes: true });
  } catch {
    return { removed: [] };
  }

  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = join(baseDir, entry.name);
    let mtime = 0;
    try {
      mtime = (await stat(full)).mtimeMs;
    } catch {
      continue;
    }
    dirs.push({ id: entry.name, full, mtime });
  }

  dirs.sort((a, b) => b.mtime - a.mtime);

  const mustKeep = dirs.filter((d) => keepIds.has(d.id));
  const others = dirs.filter((d) => !keepIds.has(d.id));
  const budget = Math.max(0, keepLast - mustKeep.length);
  const keepSet = new Set([...mustKeep, ...others.slice(0, budget)].map((d) => d.id));

  const removed = [];
  for (const dir of dirs) {
    if (keepSet.has(dir.id)) continue;
    await rm(dir.full, { recursive: true, force: true }).catch(() => null);
    removed.push(dir.id);
  }

  return { removed, kept: [...keepSet] };
}

function assertNotCancelled(cancelState) {
  if (cancelState?.cancelled) {
    throw new Error('Session cancelled');
  }
}

async function applyFixBranch(workDir, sessionId, diagnosis, { reuseBranch } = {}) {
  const branch = reuseBranch || `tracefix/fix-${sessionId.slice(-8)}`;
  await git(['config', 'user.email', 'tracefix-bot@users.noreply.github.com'], workDir);
  await git(['config', 'user.name', 'TraceFix'], workDir);
  if (reuseBranch) {
    const co = await git(['checkout', branch], workDir);
    if (co.exitCode !== 0) {
      await git(['checkout', '-B', branch], workDir);
    }
  } else {
    const co = await git(['checkout', '-b', branch], workDir);
    if (co.exitCode !== 0) {
      // Branch may already exist from a prior attempt in this sandbox
      await git(['checkout', '-B', branch], workDir);
    }
  }
  for (const file of diagnosis.suggestedFiles || []) {
    if (SECRET_FILE_NAMES.has(basename(file.path)) || /(^|\/)\.env(\.|$)/i.test(file.path)) {
      continue;
    }
    const target = join(workDir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
  const report = diagnosis.reportMarkdown || `# TraceFix\n\n${diagnosis.rootCause || ''}\n`;
  await writeFile(join(workDir, 'TRACEFIX_REPORT.md'), report, 'utf8');
  await git(['add', '-A'], workDir);
  // Never commit secret env files into the fix branch
  await git(['reset', 'HEAD', '--', '.env'], workDir).catch(() => null);

  const status = await git(['status', '--porcelain'], workDir);
  const dirty = Boolean((status.stdout || '').trim());
  const msg = `tracefix: ${String(diagnosis.summary || 'automated fix').replace(/["\r\n]/g, ' ')}`.slice(
    0,
    72,
  );
  // Always create a commit so GitHub PR validation has commits ahead of base.
  const commit = dirty
    ? await git(['commit', '-m', msg], workDir)
    : await git(['commit', '--allow-empty', '-m', msg], workDir);
  if (commit.exitCode !== 0) {
    throw new Error(
      `git commit failed: ${(commit.stderr || commit.stdout || '').slice(0, 400)}`,
    );
  }
  return branch;
}

async function tryPushBranch(workDir, branch) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, reason: 'no GITHUB_TOKEN' };
  const remote = await git(['remote', 'get-url', 'origin'], workDir).catch(() => null);
  if (!remote?.stdout?.trim()) return { ok: false, reason: 'no origin remote' };
  const result = await git(['push', '-u', 'origin', branch], workDir).catch((err) => ({
    exitCode: 1,
    stderr: err.message,
  }));
  return {
    ok: result.exitCode === 0,
    reason: result.exitCode === 0 ? null : (result.stderr || result.stdout || '').slice(0, 300),
  };
}

async function scrubCopiedSecrets(workDir) {
  // Marker only — runtime .env stays for the target app; search/commit paths skip secrets.
  try {
    await writeFile(
      join(workDir, '.tracefix-secrets-policy'),
      'Secret files (.env*) are kept for runtime but excluded from search, LLM patches, and fix commits.\n',
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

async function sandboxHasEnvFile(workDir) {
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    try {
      await stat(join(workDir, name));
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function redactSecrets(text) {
  return String(text || '')
    .replace(/\b(hf_[A-Za-z0-9]{10,})\b/g, 'hf_***')
    .replace(/\b(sk-[A-Za-z0-9]{10,})\b/g, 'sk_***')
    .replace(/(mongodb(?:\+srv)?:\/\/)([^/\s]+)/gi, '$1***')
    .replace(/((?:API[_-]?KEY|SECRET|PASSWORD|TOKEN)\s*[=:]\s*)([^\s]+)/gi, '$1***');
}

async function detectProject(workDir) {
  try {
    const pkg = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf8'));
    let packageManager = 'npm';
    try {
      await readFile(join(workDir, 'pnpm-lock.yaml'));
      packageManager = 'pnpm';
    } catch {
      try {
        await readFile(join(workDir, 'yarn.lock'));
        packageManager = 'yarn';
      } catch {
        /* npm */
      }
    }
    return {
      kind: pkg.dependencies?.next ? 'next' : pkg.dependencies?.react ? 'react' : 'node',
      packageManager,
      scripts: Object.keys(pkg.scripts || {}),
      name: pkg.name || null,
    };
  } catch {
    return { kind: 'unknown', packageManager: 'npm', scripts: [], name: null };
  }
}

async function installDeps(cwd, pm) {
  const cmd = pm === 'yarn' ? 'yarn' : pm;
  const args = pm === 'yarn' ? ['install'] : ['install'];
  const result = await exec(cmd, args, { cwd, timeoutMs: 10 * 60_000 });
  if (result.exitCode !== 0) {
    throw new Error(`Install failed: ${(result.stderr || result.stdout).slice(0, 1200)}`);
  }
}

async function startServer(cwd, pm, readyTimeoutMs = 60_000) {
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
  const script = pkg.scripts?.dev ? 'dev' : pkg.scripts?.start ? 'start' : null;
  if (!script) throw new Error('No dev/start script in package.json');

  const port = 4318;
  await waitForPortFree(port, 15_000);
  const cmd = pm === 'yarn' ? 'yarn' : pm;
  const args = pm === 'npm' ? ['run', script] : [script];
  const child = spawn(cmd, args, {
    cwd,
    shell: true,
    windowsHide: true,
    env: { ...process.env, PORT: String(port), BROWSER: 'none', CI: 'true', HOST: '127.0.0.1' },
  });

  const url = `http://127.0.0.1:${port}`;
  const ready = await waitForHttp(url, readyTimeoutMs);
  if (!ready) {
    await killTree(child);
    throw new Error(`Server did not become ready at ${url} within ${readyTimeoutMs}ms`);
  }
  await warmUpUrl(url, 8_000);
  return { child, url, port, pid: child.pid };
}

async function stopProcess(server) {
  if (!server?.child) return;
  await killTree(server.child);
  if (server.port) await waitForPortFree(server.port, 15_000);
}

async function killTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      await exec('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeoutMs: 15_000 }).catch(
        () => null,
      );
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      await new Promise((r) => setTimeout(r, 500));
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

async function waitForPortFree(port, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const busy = await isPortInUse(port);
    if (!busy) return true;
    // Best-effort: kill whatever still holds the port (stale Next/node).
    if (process.platform === 'win32') {
      await exec(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
        ],
        { timeoutMs: 8_000 },
      ).catch(() => null);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return !(await isPortInUse(port));
}

async function isPortInUse(port) {
  const { createConnection } = await import('node:net');
  return new Promise((resolvePromise) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.setTimeout(700);
    socket.on('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.on('error', () => {
      resolvePromise(false);
    });
  });
}

/** Extra GETs so Next finish compiling before Playwright/confirm. */
async function warmUpUrl(url, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.status >= 100 && res.status < 600) {
        await res.arrayBuffer().catch(() => null);
        return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

async function runProjectTests(cwd, pm) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
  } catch {
    return { ok: false, skipped: true, reason: 'no package.json' };
  }
  if (!pkg.scripts?.test) return { ok: true, skipped: true, reason: 'no test script' };

  const cmd = pm === 'yarn' ? 'yarn' : pm;
  const args = pm === 'npm' ? ['test', '--', '--watchAll=false'] : ['test'];
  const result = await exec(cmd, args, { cwd, timeoutMs: 5 * 60_000, env: { CI: 'true' } });
  return {
    ok: result.exitCode === 0,
    skipped: false,
    exitCode: result.exitCode,
    stdoutTail: (result.stdout || '').slice(-800),
    stderrTail: (result.stderr || '').slice(-800),
  };
}

async function readGitLog(cwd) {
  const result = await git(['log', '-n', '12', '--oneline'], cwd).catch(() => ({
    stdout: '',
    exitCode: 1,
  }));
  const log = (result.stdout || '').trim();
  return {
    log,
    commits: log ? log.split(/\r?\n/).filter(Boolean) : [],
  };
}

async function searchCode(root, query) {
  const hits = [];
  const terms = String(query)
    .split(/[\s,/\\:]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 5);
  const needles = terms.length ? terms : [String(query).slice(0, 60)];
  for (const term of needles) {
    await walk(root, root, hits, term, 12);
    if (hits.length >= 12) break;
  }
  return { hits: hits.slice(0, 12), hitCount: hits.length };
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const TEXT = /\.(js|jsx|ts|tsx|mjs|cjs|json|md|css|html|yml|yaml|txt)$/i;

async function walk(dir, root, hits, query, limit) {
  if (hits.length >= limit) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (hits.length >= limit) return;
    if (SKIP.has(entry.name)) continue;
    if (SECRET_FILE_NAMES.has(entry.name) || entry.name.startsWith('.env')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, hits, query, limit);
      continue;
    }
    if (!TEXT.test(entry.name)) continue;
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.size > 400_000) continue;
    let content;
    try {
      content = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    const idx = content.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) continue;
    const line = content.slice(0, idx).split(/\r?\n/).length;
    hits.push({
      path: relative(root, full).replace(/\\/g, '/'),
      line,
      snippet: content
        .split(/\r?\n/)
        .slice(Math.max(0, line - 2), line + 2)
        .join('\n')
        .slice(0, 300),
    });
  }
}

function git(args, cwd) {
  return exec('git', args, { cwd, timeoutMs: 30_000, shell: false });
}

function exec(command, args, { cwd, timeoutMs = 10_000, env, shell = true } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell,
      windowsHide: true,
      env: { ...process.env, ...(env || {}), GIT_TERMINAL_PROMPT: '0' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error(`Timeout: ${command}`));
    }, timeoutMs);
    child.stdout?.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr?.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      // Any HTTP response means the process is serving (even 404/500).
      if (res.status >= 100 && res.status < 600) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Fail-fast: requires the URL to answer within timeoutMs (not just listen). */
async function assertHttpAlive(url, timeoutMs = 8_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status >= 100 && res.status < 600) {
        // Consume a little body so hung handlers that never finish are detected.
        await res.arrayBuffer().catch(() => null);
        return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
