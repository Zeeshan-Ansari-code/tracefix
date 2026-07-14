'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, apiBase } from '../../lib/api.js';
import { useAuth } from '../../components/auth/AuthProvider.jsx';
import styles from './debug.module.css';

const STEPS = [
  'Run the app',
  'Read console',
  'Read network',
  'Read git history',
  'Find root cause',
  'Suggest fix',
  'Apply branch',
  'Run tests',
  'Confirm resolved',
];

export default function DebugPage() {
  const router = useRouter();
  const { user, refresh } = useAuth();

  const [sourceType, setSourceType] = useState('github');
  const [projectPath, setProjectPath] = useState('');
  const [repoFullName, setRepoFullName] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [errorDescription, setErrorDescription] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [openBranch, setOpenBranch] = useState(true);
  const [openPr, setOpenPr] = useState(true);
  const [runTests, setRunTests] = useState(true);
  const [skipBrowser, setSkipBrowser] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [starting, setStarting] = useState(false);
  const [githubStatus, setGithubStatus] = useState(null);

  useEffect(() => {
    const gh = new URLSearchParams(window.location.search).get('github');
    if (gh === 'connected') {
      setNotice('GitHub connected. Pick a repository to debug.');
      refresh?.();
    } else if (gh === 'token_failed' || gh === 'error' || gh === 'invalid_state') {
      setError('GitHub connect failed. Check OAuth callback URL and try again.');
    } else if (gh === 'not_configured') {
      setError('GitHub OAuth is not configured on the API.');
    }
  }, [refresh]);

  useEffect(() => {
    api('/auth/github/status')
      .then((payload) => setGithubStatus(payload.data))
      .catch(() => setGithubStatus({ configured: false }));
  }, []);

  useEffect(() => {
    if (!user?.githubConnected) {
      setRepos([]);
      return;
    }
    let alive = true;
    setReposLoading(true);
    api('/github/repos')
      .then((payload) => {
        if (!alive) return;
        const list = payload.data || [];
        setRepos(list);
        if (list[0] && !repoFullName) {
          setRepoFullName(list[0].fullName);
          setBaseBranch(list[0].defaultBranch || 'main');
        }
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setReposLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user?.githubConnected]);

  function onRepoChange(fullName) {
    setRepoFullName(fullName);
    const match = repos.find((r) => r.fullName === fullName);
    if (match?.defaultBranch) setBaseBranch(match.defaultBranch);
  }

  async function onSubmit(event) {
    event.preventDefault();
    setStarting(true);
    setError('');
    try {
      const payload = await api('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          sourceType,
          projectPath: sourceType === 'local' ? projectPath : '',
          repoFullName: sourceType === 'github' ? repoFullName : '',
          baseBranch,
          openPr: sourceType === 'github' ? openPr : false,
          errorDescription,
          appUrl: appUrl.trim(),
          openBranch,
          runTests,
          skipBrowser,
        }),
      });
      router.push(`/sessions/${payload.data.id}`);
    } catch (err) {
      setError(err.message);
      setStarting(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.kicker}>Agent launch</p>
        <h1>Start a debug session</h1>
        <p className={styles.sub}>
          Connect GitHub, pick a repo, and TraceFix will clone it, diagnose, push a fix branch, and
          open a PR.
        </p>
      </header>

      <ol className={styles.strip}>
        {STEPS.map((label, i) => (
          <li key={label}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            {label}
          </li>
        ))}
      </ol>

      <section className={styles.githubBox}>
        <div>
          <strong>GitHub</strong>
          <p>
            {user?.githubConnected
              ? `Connected as @${user.githubLogin}`
              : githubStatus?.configured
                ? 'Not connected — required for clone + PR mode'
                : 'OAuth not configured on the API'}
          </p>
        </div>
        <div className={styles.githubActions}>
          {user?.githubConnected ? (
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={async () => {
                await api('/auth/github/disconnect', { method: 'POST' });
                await refresh?.();
                setRepos([]);
                setRepoFullName('');
              }}
            >
              Disconnect
            </button>
          ) : (
            <a className={styles.githubBtn} href={`${apiBase()}/auth/github`}>
              Connect GitHub
            </a>
          )}
        </div>
      </section>

      {notice ? <p className={styles.notice}>{notice}</p> : null}

      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.sourceTabs}>
          <button
            type="button"
            data-active={sourceType === 'github'}
            onClick={() => setSourceType('github')}
          >
            GitHub repo
          </button>
          <button
            type="button"
            data-active={sourceType === 'local'}
            onClick={() => setSourceType('local')}
          >
            Local path
          </button>
        </div>

        {sourceType === 'github' ? (
          <>
            <label>
              <span>Repository</span>
              <select
                value={repoFullName}
                onChange={(e) => onRepoChange(e.target.value)}
                required
                disabled={!user?.githubConnected || reposLoading}
              >
                {!user?.githubConnected ? (
                  <option value="">Connect GitHub first</option>
                ) : reposLoading ? (
                  <option value="">Loading repos…</option>
                ) : repos.length === 0 ? (
                  <option value="">No repos found</option>
                ) : (
                  repos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                      {repo.private ? ' (private)' : ''}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label>
              <span>Base branch</span>
              <input value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} required />
            </label>
          </>
        ) : (
          <label>
            <span>Local project path</span>
            <input
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="D:\AI Agents Projects\my-buggy-app"
              required
            />
          </label>
        )}

        <label>
          <span>What went wrong?</span>
          <textarea
            value={errorDescription}
            onChange={(e) => setErrorDescription(e.target.value)}
            rows={6}
            placeholder="Paste a stack trace or describe the bug…"
            required
          />
        </label>
        <label>
          <span>App URL (optional)</span>
          <input
            value={appUrl}
            onChange={(e) => setAppUrl(e.target.value)}
            placeholder="http://localhost:3000 — your already-running app"
          />
          <small className={styles.hint}>
            For live console/network proof, run the app yourself (with .env) and paste the URL.
            If empty and the sandbox has no secrets, TraceFix auto-skips browser and continues
            with code/git diagnosis.
          </small>
        </label>
        <div className={styles.checks}>
          <label>
            <input
              type="checkbox"
              checked={openBranch}
              onChange={(e) => setOpenBranch(e.target.checked)}
            />
            Apply fix on a <code>tracefix/fix-…</code> branch
          </label>
          {sourceType === 'github' ? (
            <label>
              <input
                type="checkbox"
                checked={openPr}
                onChange={(e) => setOpenPr(e.target.checked)}
                disabled={!openBranch}
              />
              Push branch and open a pull request
            </label>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={runTests}
              onChange={(e) => setRunTests(e.target.checked)}
            />
            Run project tests when available
          </label>
          <label>
            <input
              type="checkbox"
              checked={skipBrowser}
              onChange={(e) => setSkipBrowser(e.target.checked)}
            />
            Skip browser capture (code/git-only)
          </label>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button type="submit" disabled={starting || (sourceType === 'github' && !user?.githubConnected)}>
          {starting ? 'Launching agent…' : 'Run TraceFix agent'}
        </button>
      </form>
    </div>
  );
}
