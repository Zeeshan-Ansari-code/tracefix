'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/auth/AuthProvider.jsx';
import { PasswordField } from '../../components/auth/PasswordField.jsx';
import { TraceFixMark } from '../../components/brand/TraceFixMark.jsx';
import styles from '../auth.module.css';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className={styles.auth}>
      <section className={styles.heroPane}>
        <div className={styles.brandRow}>
          <TraceFixMark size={48} />
          <p className={styles.brand}>TraceFix</p>
        </div>
        <h1>Your AI debugging agent command center.</h1>
        <p>
          Track what broke, what the agent found, what got fixed, and whether the issue is actually
          gone — with live console, network, git, and verify evidence.
        </p>
      </section>
      <section className={styles.formPane}>
        <form className={styles.form} onSubmit={onSubmit}>
          <h2>Sign in</h2>
          <p className={styles.help}>Welcome to your agent workspace.</p>
          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <PasswordField
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className={styles.switch}>
            New here? <Link href="/signup">Create an account</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
