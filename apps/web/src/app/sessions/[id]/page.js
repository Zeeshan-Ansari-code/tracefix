'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../lib/api.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.jsx';
import { TraceFixLoader } from '../../../components/ui/TraceFixLoader.jsx';
import styles from './page.module.css';

const ORDER = [
  'run_app',
  'console',
  'network',
  'git_history',
  'root_cause',
  'suggest_fix',
  'apply_branch',
  'run_tests',
  'confirm',
];

const LABELS = {
  run_app: 'Run the app',
  console: 'Read browser console',
  network: 'Read network logs',
  git_history: 'Read Git history',
  root_cause: 'Find the root cause',
  suggest_fix: 'Suggest a fix',
  apply_branch: 'Apply fix in a branch',
  run_tests: 'Run tests',
  confirm: 'Confirm the issue is resolved',
};

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id;
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const summaryRef = useRef(null);
  const scrolledForDiagnosis = useRef(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const payload = await api(`/sessions/${id}`);
        if (alive) setSession(payload.data);
      } catch (err) {
        if (alive) setError(err.message);
      }
    }
    load();
    const timer = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    scrolledForDiagnosis.current = false;
  }, [id]);

  const byId = useMemo(() => {
    const map = new Map((session?.steps || []).map((s) => [s.id, s]));
    return map;
  }, [session]);

  useEffect(() => {
    const diagnosisReady =
      Boolean(session?.result?.diagnosis) ||
      (session?.steps || []).some((s) => s.id === 'root_cause' && s.status === 'completed');
    if (!diagnosisReady || scrolledForDiagnosis.current) return;
    scrolledForDiagnosis.current = true;
    requestAnimationFrame(() => {
      summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [session]);

  async function onCancel() {
    setCancelling(true);
    try {
      const payload = await api(`/sessions/${id}/cancel`, { method: 'POST' });
      setSession(payload.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await api(`/sessions/${id}`, { method: 'DELETE' });
      router.push('/sessions');
    } catch (err) {
      setError(err.message);
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (error) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>{error}</p>
        <Link href="/sessions">Back to sessions</Link>
      </div>
    );
  }

  if (!session) return <TraceFixLoader label="Loading session" size={48} />;

  const diagnosis = session.result?.diagnosis;
  const verify = session.result?.verify;
  const rootStep = byId.get('root_cause');
  const showSummary = Boolean(
    diagnosis || verify || session.result?.branch || rootStep?.status === 'completed',
  );

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div>
          <Link href="/sessions" className={styles.back}>
            ← Sessions
          </Link>
          <h1>Session timeline</h1>
          <p className={styles.muted}>{session.projectPath}</p>
        </div>
        <div className={styles.actions}>
          {['queued', 'running'].includes(session.status) ? (
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onCancel}
              disabled={cancelling || deleting}
            >
              {cancelling ? 'Cancelling…' : 'Cancel run'}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={() => setDeleteOpen(true)}
            disabled={deleting || cancelling}
          >
            Delete
          </button>
          <span className={styles.status} data-status={session.status}>
            {session.status}
          </span>
        </div>
      </header>

      <p className={styles.problem}>{session.errorDescription}</p>

      {showSummary ? (
        <section className={styles.summary} ref={summaryRef}>
          {(diagnosis || rootStep?.status === 'completed') && (
            <article className={styles.rootCause}>
              <span>Root cause</span>
              <strong>
                {diagnosis?.summary || rootStep?.data?.summary || 'Diagnosis ready'}
              </strong>
              <p>{diagnosis?.rootCause || rootStep?.logs}</p>
              <em>
                {(diagnosis?.confidence || rootStep?.data?.confidence || '—') +
                  ' · ' +
                  (diagnosis?.provider || rootStep?.data?.provider || 'agent')}
              </em>
            </article>
          )}

          {(verify || session.result?.branch) && (
            <div className={styles.summaryMeta}>
              {verify ? (
                <article>
                  <span>Verify</span>
                  <strong>{verify.status}</strong>
                  <p>
                    Signals {verify.before?.total ?? 0} → {verify.after?.total ?? 0}
                  </p>
                  <em>{(verify.notes || []).join(' · ')}</em>
                </article>
              ) : null}
              {session.result?.branch ? (
                <article>
                  <span>Branch</span>
                  <strong>{session.result.branch}</strong>
                  <p>
                    {session.result?.pullRequest?.htmlUrl ? (
                      <a href={session.result.pullRequest.htmlUrl} target="_blank" rel="noreferrer">
                        Open pull request #{session.result.pullRequest.number}
                      </a>
                    ) : session.sourceType === 'github' ? (
                      'Pushed / ready on GitHub'
                    ) : (
                      'Sandbox copy of your project'
                    )}
                  </p>
                </article>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      <ol className={styles.timeline}>
        {ORDER.map((stepId, index) => {
          const step = byId.get(stepId);
          const terminal = ['completed', 'failed', 'cancelled'].includes(session.status);
          let status = step?.status || 'pending';
          let logs = step?.logs;
          if (!step && terminal) {
            status = 'skipped';
            logs =
              session.status === 'failed' || session.status === 'cancelled'
                ? 'Not reached (run ended earlier)'
                : 'Not reached';
          }
          return (
            <li key={stepId} data-status={status}>
              <div className={styles.rail}>
                <span className={styles.dot} />
                {index < ORDER.length - 1 ? <span className={styles.line} /> : null}
              </div>
              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <strong>{LABELS[stepId]}</strong>
                  <em>{status}</em>
                </div>
                {logs ? <pre>{logs}</pre> : <p className={styles.muted}>Waiting…</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {session.error ? (
        <section className={styles.fail}>
          <h2>Failed</h2>
          <pre>{session.error}</pre>
        </section>
      ) : null}

      <ConfirmModal
        open={deleteOpen}
        title="Delete session?"
        message="This removes the session history and its sandbox copy. This cannot be undone."
        confirmLabel="Delete session"
        busy={deleting}
        onCancel={() => !deleting && setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
