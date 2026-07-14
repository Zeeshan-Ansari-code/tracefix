'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api.js';
import { ConfirmModal } from '../../components/ui/ConfirmModal.jsx';
import styles from './sessions.module.css';

export default function SessionsPage() {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const payload = await api('/sessions');
        if (alive) setSessions(payload.data || []);
      } catch (err) {
        if (alive) setError(err.message);
      }
    }
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError('');
    try {
      await api(`/sessions/${pendingDelete.id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  if (error && sessions.length === 0) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>History</p>
          <h1>All sessions</h1>
        </div>
        <Link href="/debug" className={styles.cta}>
          New debug
        </Link>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      {sessions.length === 0 ? (
        <p className={styles.muted}>No sessions yet. Launch your first debug run.</p>
      ) : (
        <ul className={styles.grid}>
          {sessions.map((session) => (
            <li key={session.id}>
              <div className={styles.top}>
                <span data-status={session.status}>{session.status}</span>
                <time>{new Date(session.createdAt).toLocaleString()}</time>
              </div>
              <p className={styles.desc}>{session.errorDescription}</p>
              <p className={styles.path}>{session.projectPath}</p>
              <div className={styles.meta}>
                <span>{session.result?.verify?.status || 'no verify'}</span>
                <span>{session.result?.branch || 'no branch'}</span>
              </div>
              <div className={styles.rowActions}>
                <Link href={`/sessions/${session.id}`}>Open timeline</Link>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={() => setPendingDelete(session)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Delete session?"
        message={
          pendingDelete
            ? `This removes the session history and sandbox for “${String(pendingDelete.errorDescription || pendingDelete.id).slice(0, 80)}”. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete session"
        busy={deleting}
        onCancel={() => !deleting && setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
