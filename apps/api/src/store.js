import { randomUUID } from 'node:crypto';
import { mongoose } from './db.js';

const { Schema, model, models } = mongoose;

const userSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    githubLogin: { type: String, default: null },
    githubAccessToken: { type: String, default: null },
    githubConnectedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const debugSessionSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    projectPath: { type: String, required: true },
    sourceType: { type: String, enum: ['local', 'github'], default: 'local' },
    repoFullName: { type: String, default: '' },
    baseBranch: { type: String, default: 'main' },
    openPr: { type: Boolean, default: false },
    errorDescription: { type: String, required: true },
    appUrl: { type: String, default: '' },
    openBranch: { type: Boolean, default: true },
    runTests: { type: Boolean, default: true },
    skipBrowser: { type: Boolean, default: false },
    maxFixAttempts: { type: Number, default: 2 },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    steps: { type: Array, default: [] },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

debugSessionSchema.index({ userId: 1, createdAt: -1 });

export const User = models.User || model('User', userSchema);
export const DebugSession = models.DebugSession || model('DebugSession', debugSessionSchema);

function toSession(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: obj.id,
    userId: obj.userId,
    projectPath: obj.projectPath,
    sourceType: obj.sourceType || 'local',
    repoFullName: obj.repoFullName || '',
    baseBranch: obj.baseBranch || 'main',
    openPr: Boolean(obj.openPr),
    errorDescription: obj.errorDescription,
    appUrl: obj.appUrl || '',
    openBranch: Boolean(obj.openBranch),
    runTests: Boolean(obj.runTests),
    skipBrowser: Boolean(obj.skipBrowser),
    maxFixAttempts: Number(obj.maxFixAttempts || 2),
    status: obj.status,
    steps: obj.steps || [],
    result: obj.result ?? null,
    error: obj.error ?? null,
    startedAt: obj.startedAt ? new Date(obj.startedAt).toISOString() : null,
    finishedAt: obj.finishedAt ? new Date(obj.finishedAt).toISOString() : null,
    createdAt: obj.createdAt ? new Date(obj.createdAt).toISOString() : null,
  };
}

function toUser(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: obj.id,
    name: obj.name,
    email: obj.email,
    passwordHash: obj.passwordHash,
    githubLogin: obj.githubLogin || null,
    githubAccessToken: obj.githubAccessToken || null,
    githubConnectedAt: obj.githubConnectedAt ? new Date(obj.githubConnectedAt).toISOString() : null,
    createdAt: obj.createdAt ? new Date(obj.createdAt).toISOString() : null,
  };
}

export async function initStore() {
  // connection is established in index via connectMongo()
}

export async function createUser({ name, email, passwordHash }) {
  const user = await User.create({
    id: randomUUID().replace(/-/g, '').slice(0, 12),
    name,
    email: String(email).toLowerCase(),
    passwordHash,
  });
  return publicUser(toUser(user));
}

export async function findUserByEmail(email) {
  const user = await User.findOne({ email: String(email).toLowerCase() }).lean();
  return toUser(user);
}

export async function findUserById(id) {
  const user = await User.findOne({ id }).lean();
  return toUser(user);
}

export async function linkGithubAccount(userId, { githubLogin, githubAccessToken }) {
  const user = await User.findOneAndUpdate(
    { id: userId },
    {
      $set: {
        githubLogin,
        githubAccessToken,
        githubConnectedAt: new Date(),
      },
    },
    { new: true },
  ).lean();
  return publicUser(toUser(user));
}

export async function unlinkGithubAccount(userId) {
  const user = await User.findOneAndUpdate(
    { id: userId },
    { $set: { githubLogin: null, githubAccessToken: null, githubConnectedAt: null } },
    { new: true },
  ).lean();
  return publicUser(toUser(user));
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    githubConnected: Boolean(user.githubAccessToken),
    githubLogin: user.githubLogin || null,
  };
}

export async function createSession(data) {
  const session = await DebugSession.create({
    id: randomUUID().replace(/-/g, '').slice(0, 16),
    ...data,
    startedAt: null,
    finishedAt: null,
  });
  return toSession(session);
}

export async function getSession(id) {
  const session = await DebugSession.findOne({ id }).lean();
  return toSession(session);
}

export async function updateSession(id, patch) {
  const next = { ...patch };
  if (typeof next.startedAt === 'string') next.startedAt = new Date(next.startedAt);
  if (typeof next.finishedAt === 'string') next.finishedAt = new Date(next.finishedAt);

  const session = await DebugSession.findOneAndUpdate({ id }, { $set: next }, { new: true }).lean();
  return toSession(session);
}

export async function deleteSession(id) {
  const result = await DebugSession.deleteOne({ id });
  return result.deletedCount > 0;
}

export async function listSessions(userId) {
  const query = userId ? { userId } : {};
  const sessions = await DebugSession.find(query).sort({ createdAt: -1 }).limit(100).lean();
  return sessions.map(toSession);
}

/** Local YYYY-MM-DD (avoids UTC day-shift from toISOString for IST etc.). */
function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function getAnalytics(userId) {
  const sessions = await listSessions(userId);
  const completed = sessions.filter((s) => s.status === 'completed');
  const failed = sessions.filter((s) => s.status === 'failed');
  const running = sessions.filter(
    (s) => s.status === 'running' || s.status === 'queued',
  );

  const verifyCounts = {
    resolved: 0,
    improved: 0,
    unchanged: 0,
    worse: 0,
    skipped: 0,
    limited: 0,
    inconclusive: 0,
  };
  let branches = 0;
  let testsPassed = 0;
  let testsFailed = 0;

  for (const s of completed) {
    const status = s.result?.verify?.status;
    if (status && verifyCounts[status] != null) verifyCounts[status] += 1;
    if (s.result?.branch) branches += 1;
    if (s.result?.tests && !s.result.tests.skipped) {
      if (s.result.tests.ok) testsPassed += 1;
      else testsFailed += 1;
    }
  }

  const byDay = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    // Use local calendar dates — toISOString() is UTC and shifts the day for IST (+5:30).
    const key = localDateKey(d);
    const label = d.toLocaleDateString(undefined, { weekday: 'short' });
    const count = sessions.filter((s) => s.createdAt && localDateKey(s.createdAt) === key).length;
    byDay.push({ label, value: count, key });
  }

  const recentFixed = completed
    .filter((s) => s.result?.verify?.status === 'resolved' || s.result?.verify?.status === 'improved')
    .slice(0, 8)
    .map((s) => ({
      id: s.id,
      summary: s.result?.diagnosis?.summary || s.errorDescription,
      status: s.result?.verify?.status,
      createdAt: s.createdAt,
    }));

  return {
    totals: {
      sessions: sessions.length,
      completed: completed.length,
      failed: failed.length,
      active: running.length,
      branches,
      testsPassed,
      testsFailed,
      resolved: verifyCounts.resolved + verifyCounts.improved,
    },
    verifyCounts,
    byDay,
    recentFixed,
    recent: sessions.slice(0, 10).map((s) => ({
      id: s.id,
      status: s.status,
      errorDescription: s.errorDescription,
      projectPath: s.projectPath,
      createdAt: s.createdAt,
      verify: s.result?.verify?.status || null,
      confidence: s.result?.diagnosis?.confidence || null,
    })),
  };
}
