/**
 * GitHub helpers for TraceFix — user OAuth token (repo scope).
 * Never log URLs that embed the token.
 */
import { spawn } from 'node:child_process';

export async function githubApi(path, token, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'TraceFix',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const details = Array.isArray(json?.errors)
      ? json.errors
          .map((e) => e.message || e.code || JSON.stringify(e))
          .filter(Boolean)
          .join('; ')
      : '';
    const msg = [json?.message || text.slice(0, 300) || response.statusText, details]
      .filter(Boolean)
      .join(' — ');
    throw new Error(`GitHub API ${response.status}: ${msg}`);
  }
  return json;
}

export async function listUserRepos(token, { perPage = 50 } = {}) {
  const repos = await githubApi(
    `/user/repos?sort=updated&per_page=${perPage}&affiliation=owner,collaborator,organization_member`,
    token,
  );
  return (repos || []).map((r) => ({
    fullName: r.full_name,
    name: r.name,
    private: Boolean(r.private),
    defaultBranch: r.default_branch || 'main',
    htmlUrl: r.html_url,
    updatedAt: r.updated_at,
  }));
}

export async function shallowCloneRepo({
  workDir,
  repoFullName,
  branch,
  token,
  depth = 1,
}) {
  const remote = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
  const args = [
    'clone',
    '--depth',
    String(Math.max(1, depth)),
    '--branch',
    branch,
    remote,
    workDir,
  ];
  const result = await execGit(args, process.cwd(), 180_000);
  if (result.exitCode !== 0) {
    const safe = `${result.stderr || result.stdout}`.replaceAll(token, '[redacted]');
    if (/Remote branch .* not found/i.test(safe) || /not found in upstream/i.test(safe)) {
      const bare = await execGit(
        ['clone', '--depth', String(Math.max(1, depth)), remote, workDir],
        process.cwd(),
        180_000,
      );
      if (bare.exitCode !== 0) {
        throw new Error(
          `git clone failed: ${`${bare.stderr || bare.stdout}`.replaceAll(token, '[redacted]')}`,
        );
      }
      return { ok: true, branch: null, fallback: true };
    }
    throw new Error(`git clone failed: ${safe}`);
  }
  return { ok: true, branch };
}

export async function pushBranch({ workDir, repoFullName, branch, token, message }) {
  const remote = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
  const steps = [
    ['config', 'user.email', 'tracefix-bot@users.noreply.github.com'],
    ['config', 'user.name', 'TraceFix'],
    ['remote', 'set-url', 'origin', remote],
    ['push', '-u', 'origin', `HEAD:${branch}`],
  ];

  for (const args of steps) {
    const result = await execGit(args, workDir, 120_000);
    if (result.exitCode !== 0) {
      const safe = `${result.stderr || result.stdout}`.replaceAll(token, '[redacted]');
      throw new Error(`git ${args[0]} failed: ${safe}`);
    }
  }
  return { ok: true, branch, message };
}

/** True when head is strictly ahead of base (needed to open a PR). */
export async function branchHasCommitsAhead({ token, repoFullName, base, head }) {
  const [owner, repo] = String(repoFullName).split('/');
  const compare = await githubApi(
    `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    token,
  );
  return {
    aheadBy: Number(compare.ahead_by || 0),
    behindBy: Number(compare.behind_by || 0),
    status: compare.status,
    hasCommits: Number(compare.ahead_by || 0) > 0,
  };
}

export async function createPullRequest({
  token,
  repoFullName,
  title,
  body,
  head,
  base,
}) {
  const [owner, repo] = String(repoFullName).split('/');
  if (!owner || !repo) throw new Error(`Invalid repo: ${repoFullName}`);

  // Reuse an open PR for the same head if one already exists.
  const existing = await githubApi(
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`,
    token,
  ).catch(() => []);
  if (Array.isArray(existing) && existing[0]?.html_url) {
    return {
      ok: true,
      number: existing[0].number,
      htmlUrl: existing[0].html_url,
      title: existing[0].title,
      reused: true,
    };
  }

  const comparison = await branchHasCommitsAhead({
    token,
    repoFullName,
    base,
    head,
  }).catch(() => null);

  if (comparison && !comparison.hasCommits) {
    throw new Error(
      `No commits on ${head} ahead of ${base} (ahead_by=${comparison.aheadBy}). Commit a change before opening a PR.`,
    );
  }

  try {
    const pr = await githubApi(`/repos/${owner}/${repo}/pulls`, token, {
      method: 'POST',
      body: { title, body, head, base },
    });
    return {
      ok: true,
      number: pr.number,
      htmlUrl: pr.html_url,
      title: pr.title,
    };
  } catch (error) {
    const msg = String(error.message || '');
    if (/already exists/i.test(msg)) {
      const again = await githubApi(
        `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`,
        token,
      ).catch(() => []);
      if (Array.isArray(again) && again[0]?.html_url) {
        return {
          ok: true,
          number: again[0].number,
          htmlUrl: again[0].html_url,
          title: again[0].title,
          reused: true,
        };
      }
    }
    throw error;
  }
}

function execGit(args, cwd, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    // Never use shell:true — Windows splits paths with spaces (e.g. "AI Agents Projects")
    // into extra git args and fails with "Too many arguments".
    const child = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error('git timeout'));
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

export { execGit };
