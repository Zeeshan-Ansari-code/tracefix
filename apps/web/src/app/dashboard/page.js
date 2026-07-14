'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api.js';
import { BarChart } from '../../components/charts/BarChart.jsx';
import { DonutChart } from '../../components/charts/DonutChart.jsx';
import { TraceFixLoader } from '../../components/ui/TraceFixLoader.jsx';
import styles from './dashboard.module.css';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const payload = await api('/analytics');
        if (alive) setData(payload.data);
      } catch (err) {
        if (alive) setError(err.message);
      }
    }
    load();
    const timer = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const donut = useMemo(() => {
    const v = data?.verifyCounts || {};
    return [
      { label: 'Resolved', value: v.resolved || 0, color: '#15803d' },
      { label: 'Improved', value: v.improved || 0, color: '#1f9d63' },
      { label: 'Unchanged', value: v.unchanged || 0, color: '#64748b' },
      { label: 'Worse', value: v.worse || 0, color: '#b42318' },
      { label: 'Skipped', value: v.skipped || 0, color: '#b45309' },
      { label: 'Limited', value: v.limited || 0, color: '#2563eb' },
    ].filter((s) => s.value > 0);
  }, [data]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <TraceFixLoader label="Loading analytics" size={48} />;

  const t = data.totals;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Agent operations</p>
          <h1>Debugging dashboard</h1>
          <p className={styles.sub}>
            What ran, what failed, what got fixed, and what still needs attention.
          </p>
        </div>
        <Link href="/debug" className={styles.cta}>
          New debug session
        </Link>
      </header>

      <section className={styles.kpiRow}>
        <article>
          <span>Sessions</span>
          <strong>{t.sessions}</strong>
        </article>
        <article>
          <span>Active</span>
          <strong>{t.active}</strong>
        </article>
        <article>
          <span>Completed</span>
          <strong>{t.completed}</strong>
        </article>
        <article>
          <span>Failed</span>
          <strong>{t.failed}</strong>
        </article>
        <article>
          <span>Fixed / improved</span>
          <strong>{t.resolved}</strong>
        </article>
        <article>
          <span>Branches opened</span>
          <strong>{t.branches}</strong>
        </article>
      </section>

      <section className={styles.charts}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Sessions this week</h2>
            <p>Volume of debug runs by day</p>
          </div>
          <BarChart points={data.byDay} />
        </div>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Verify outcomes</h2>
            <p>After-fix confirmation results</p>
          </div>
          {donut.length ? (
            <DonutChart segments={donut} />
          ) : (
            <p className={styles.muted}>No verify outcomes yet — run a session with confirmation.</p>
          )}
        </div>
      </section>

      <section className={styles.lower}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Recent activity</h2>
            <p>Latest agent sessions</p>
          </div>
          <ul className={styles.list}>
            {data.recent.length === 0 ? (
              <li className={styles.muted}>No sessions yet.</li>
            ) : (
              data.recent.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.status}</strong>
                    <span>{String(item.errorDescription || '').slice(0, 80)}</span>
                  </div>
                  <em>{item.verify || item.confidence || '—'}</em>
                  <Link href={`/sessions/${item.id}`}>Open</Link>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>What got fixed</h2>
            <p>Resolved or improved after verify</p>
          </div>
          <ul className={styles.list}>
            {data.recentFixed.length === 0 ? (
              <li className={styles.muted}>No confirmed fixes yet.</li>
            ) : (
              data.recentFixed.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.status}</strong>
                    <span>{String(item.summary || '').slice(0, 80)}</span>
                  </div>
                  <Link href={`/sessions/${item.id}`}>View</Link>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
