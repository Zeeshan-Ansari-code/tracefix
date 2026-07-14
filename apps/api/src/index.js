import './env.js';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import cookieSession from 'cookie-session';
import bcrypt from 'bcryptjs';
import { existsSync, statSync } from 'node:fs';
import { z } from 'zod';
import { PIPELINE_STEPS, runDebugSession, listUserRepos } from '@tracefix/agent';
import {
  initStore,
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
  createUser,
  findUserByEmail,
  findUserById,
  publicUser,
  getAnalytics,
  linkGithubAccount,
  unlinkGithubAccount,
} from './store.js';
import { connectMongo } from './db.js';
import { rm } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4100);
const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:3100';
const SESSION_SECRET = process.env.SESSION_SECRET || 'tracefix-dev-secret-change-me';
const ROOT = resolve(__dirname, '../../..');
const SANDBOX_DIR = process.env.SANDBOX_DIR || '.tracefix-sandboxes';

const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  password: z.string().min(6).max(100),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const createSchema = z
  .object({
    sourceType: z.enum(['local', 'github']).default('local'),
    projectPath: z.string().optional().or(z.literal('')),
    repoFullName: z.string().optional().or(z.literal('')),
    baseBranch: z.string().default('main'),
    openPr: z.boolean().default(true),
    errorDescription: z.string().min(3),
    appUrl: z.string().url().optional().or(z.literal('')),
    openBranch: z.boolean().default(true),
    runTests: z.boolean().default(true),
    skipBrowser: z.boolean().default(false),
    maxFixAttempts: z.number().int().min(1).max(5).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.sourceType === 'github') {
      if (!val.repoFullName || !val.repoFullName.includes('/')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'repoFullName is required (owner/repo)' });
      }
    } else if (!val.projectPath || val.projectPath.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'projectPath is required for local runs' });
    }
  });

function getGithubOAuthConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID || '';
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || '';
  const apiUrl = process.env.API_URL || `http://localhost:${PORT}`;
  const scopes = process.env.GITHUB_OAUTH_SCOPES || 'repo read:user user:email';
  return {
    clientId,
    clientSecret,
    configured: Boolean(clientId && clientSecret),
    callbackUrl: `${apiUrl}/auth/github/callback`,
    scopes,
    webUrl: WEB_ORIGIN,
  };
}

await connectMongo();
await initStore();

const app = express();
app.set('trust proxy', 1);
app.use(
  cors({
    origin: WEB_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(
  cookieSession({
    name: 'tracefix_session',
    keys: [SESSION_SECRET],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
  }),
);

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Sign in required' });
  }
  return next();
}

/** Serial job queue so one agent run at a time. */
const jobQueue = [];
let queueBusy = false;
const activeRuns = new Map();

function enqueueSession(sessionId) {
  jobQueue.push(sessionId);
  pumpQueue();
}

async function pumpQueue() {
  if (queueBusy) return;
  queueBusy = true;
  while (jobQueue.length) {
    const id = jobQueue.shift();
    try {
      await runSession(id);
    } catch {
      /* runSession persists failures */
    }
  }
  queueBusy = false;
}

app.get('/health', (_req, res) => {
  const gh = getGithubOAuthConfig();
  res.json({
    ok: true,
    service: 'tracefix-api',
    llm: process.env.LLM_PROVIDER || 'mock',
    githubOAuth: gh.configured,
    queue: { pending: jobQueue.length, busy: queueBusy },
  });
});

app.get('/auth/github/status', (_req, res) => {
  const gh = getGithubOAuthConfig();
  res.json({
    data: {
      configured: gh.configured,
      callbackUrl: gh.callbackUrl,
      scopes: gh.scopes,
    },
  });
});

app.get('/auth/github', requireAuth, (req, res) => {
  const gh = getGithubOAuthConfig();
  if (!gh.configured) {
    return res.status(503).json({
      error: 'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
    });
  }
  const state = `${req.session.userId}.${Date.now()}`;
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: gh.clientId,
    redirect_uri: gh.callbackUrl,
    scope: gh.scopes,
    state,
  });
  return res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get('/auth/github/callback', async (req, res) => {
  const gh = getGithubOAuthConfig();
  try {
    if (!gh.configured) {
      return res.redirect(`${gh.webUrl}/debug?github=not_configured`);
    }
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return res.redirect(`${gh.webUrl}/debug?github=invalid_state`);
    }
    if (!req.session.userId) {
      return res.redirect(`${gh.webUrl}/login?github=login_required`);
    }
    delete req.session.oauthState;

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: gh.clientId,
        client_secret: gh.clientSecret,
        code,
        redirect_uri: gh.callbackUrl,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      return res.redirect(`${gh.webUrl}/debug?github=token_failed`);
    }

    const profileRes = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${tokenJson.access_token}`,
        'User-Agent': 'TraceFix',
      },
    });
    const profile = await profileRes.json();
    await linkGithubAccount(req.session.userId, {
      githubLogin: profile.login,
      githubAccessToken: tokenJson.access_token,
    });
    return res.redirect(`${gh.webUrl}/debug?github=connected`);
  } catch {
    return res.redirect(`${gh.webUrl}/debug?github=error`);
  }
});

app.post('/auth/github/disconnect', requireAuth, async (req, res) => {
  const user = await unlinkGithubAccount(req.session.userId);
  res.json({ data: user });
});

app.get('/github/repos', requireAuth, async (req, res) => {
  try {
    const user = await findUserById(req.session.userId);
    if (!user?.githubAccessToken) {
      return res.status(400).json({ error: 'Connect GitHub first' });
    }
    const repos = await listUserRepos(user.githubAccessToken);
    return res.json({ data: repos });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/pipeline', (_req, res) => {
  res.json({ data: PIPELINE_STEPS });
});

app.post('/auth/signup', async (req, res) => {
  try {
    const body = signupSchema.parse(req.body);
    const existing = await findUserByEmail(body.email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await createUser({
      name: body.name,
      email: body.email,
      passwordHash,
    });
    req.session.userId = user.id;
    return res.status(201).json({ data: user });
  } catch (error) {
    if (error?.name === 'ZodError') {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input' });
    }
    return res.status(500).json({ error: error.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await findUserByEmail(body.email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    req.session.userId = user.id;
    return res.json({ data: publicUser(user) });
  } catch (error) {
    if (error?.name === 'ZodError') {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input' });
    }
    return res.status(500).json({ error: error.message });
  }
});

app.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/auth/me', async (req, res) => {
  if (!req.session?.userId) return res.json({ data: null });
  const user = await findUserById(req.session.userId);
  return res.json({ data: publicUser(user) });
});

app.get('/analytics', requireAuth, async (req, res) => {
  const data = await getAnalytics(req.session.userId);
  res.json({ data });
});

app.get('/sessions', requireAuth, async (req, res) => {
  res.json({ data: await listSessions(req.session.userId) });
});

app.get('/sessions/:id', requireAuth, async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session || session.userId !== req.session.userId) {
    return res.status(404).json({ error: 'Session not found' });
  }
  return res.json({ data: session });
});

app.post('/sessions/:id/cancel', requireAuth, async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session || session.userId !== req.session.userId) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (!['queued', 'running'].includes(session.status)) {
    return res.status(400).json({ error: 'Session is not cancellable' });
  }

  const idx = jobQueue.indexOf(session.id);
  if (idx >= 0) jobQueue.splice(idx, 1);

  const active = activeRuns.get(session.id);
  if (active) {
    active.cancelled = true;
    if (typeof active.kill === 'function') {
      await active.kill().catch(() => null);
    }
  }

  const updated = await updateSession(session.id, {
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
    error: 'Session cancelled',
  });
  return res.json({ data: updated });
});

app.delete('/sessions/:id', requireAuth, async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session || session.userId !== req.session.userId) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Stop an in-flight run first
  const idx = jobQueue.indexOf(session.id);
  if (idx >= 0) jobQueue.splice(idx, 1);
  const active = activeRuns.get(session.id);
  if (active) {
    active.cancelled = true;
    if (typeof active.kill === 'function') {
      await active.kill().catch(() => null);
    }
    activeRuns.delete(session.id);
  }

  await deleteSession(session.id);

  const sandboxPath = join(ROOT, SANDBOX_DIR, session.id);
  await rm(sandboxPath, { recursive: true, force: true }).catch(() => null);

  return res.json({ ok: true, id: session.id });
});

app.post('/sessions', requireAuth, async (req, res) => {
  try {
    const body = createSchema.parse(req.body);
    const sourceType = body.sourceType || 'local';
    let projectPath = '';
    let repoFullName = '';
    let baseBranch = body.baseBranch || 'main';

    if (sourceType === 'github') {
      const user = await findUserById(req.session.userId);
      if (!user?.githubAccessToken) {
        return res.status(400).json({ error: 'Connect GitHub before starting a GitHub session' });
      }
      repoFullName = body.repoFullName;
      projectPath = `github:${repoFullName}`;
    } else {
      projectPath = resolve(body.projectPath);
      if (!existsSync(projectPath)) {
        return res.status(400).json({ error: `Project path not found: ${projectPath}` });
      }
      try {
        if (!statSync(projectPath).isDirectory()) {
          return res.status(400).json({ error: `Project path must be a directory: ${projectPath}` });
        }
        if (!existsSync(join(projectPath, 'package.json'))) {
          return res.status(400).json({
            error: `No package.json at ${projectPath}. Use the app root (the folder that contains package.json).`,
          });
        }
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const session = await createSession({
      userId: req.session.userId,
      projectPath,
      sourceType,
      repoFullName,
      baseBranch,
      openPr: sourceType === 'github' ? Boolean(body.openPr) : false,
      errorDescription: body.errorDescription,
      appUrl: body.appUrl || '',
      openBranch: body.openBranch,
      runTests: body.runTests,
      skipBrowser: body.skipBrowser,
      maxFixAttempts: body.maxFixAttempts ?? Number(process.env.MAX_FIX_ATTEMPTS || 2),
      status: 'queued',
      steps: [],
      result: null,
      error: null,
    });

    res.status(201).json({ data: session });
    enqueueSession(session.id);
    return undefined;
  } catch (error) {
    if (error?.name === 'ZodError') {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input' });
    }
    return res.status(500).json({ error: error.message });
  }
});

async function runSession(id) {
  const session = await getSession(id);
  if (!session) return;
  if (session.status === 'cancelled') return;

  const cancelState = { cancelled: false, kill: null };
  activeRuns.set(id, cancelState);

  await updateSession(id, { status: 'running', startedAt: new Date().toISOString() });

  try {
    if (cancelState.cancelled) {
      throw new Error('Session cancelled');
    }

    const user = await findUserById(session.userId);
    const result = await runDebugSession(
      {
        sessionId: id,
        projectPath: session.projectPath,
        errorDescription: session.errorDescription,
        appUrl: session.appUrl,
        openBranch: session.openBranch,
        runTests: session.runTests,
        skipBrowser: session.skipBrowser,
        maxFixAttempts: session.maxFixAttempts,
        cancelState,
        sourceType: session.sourceType || 'local',
        repoFullName: session.repoFullName || '',
        baseBranch: session.baseBranch || 'main',
        openPr: Boolean(session.openPr),
        githubToken: user?.githubAccessToken || '',
      },
      async (step) => {
        if (cancelState.cancelled) return;
        const current = await getSession(id);
        if (!current || current.status === 'cancelled') return;
        const steps = [...(current?.steps || [])];
        const idx = steps.findIndex((s) => s.id === step.id);
        if (idx >= 0) steps[idx] = step;
        else steps.push(step);
        await updateSession(id, { steps });
      },
    );

    const latest = await getSession(id);
    if (latest?.status === 'cancelled' || cancelState.cancelled) {
      return;
    }

    await updateSession(id, {
      status: 'completed',
      finishedAt: new Date().toISOString(),
      result,
      steps: result.steps,
    });
  } catch (error) {
    const latest = await getSession(id);
    if (latest?.status === 'cancelled' || cancelState.cancelled) {
      return;
    }
    await updateSession(id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: error.message,
    });
  } finally {
    activeRuns.delete(id);
  }
}

app.listen(PORT, () => {
  console.log(`TraceFix API on http://localhost:${PORT}`);
  console.log(`LLM provider: ${process.env.LLM_PROVIDER || 'mock'}`);
});
