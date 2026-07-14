'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/auth/AuthProvider.jsx';
import { PasswordField } from '../../components/auth/PasswordField.jsx';
import { TraceFixMark } from '../../components/brand/TraceFixMark.jsx';
import styles from '../auth.module.css';

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signup(name, email, password);
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
        <h1>Ship a debugging agent you can explain.</h1>
        <p>
          Sign up, run sessions against local projects, and build a history of diagnoses, branches,
          and confirmed fixes.
        </p>
      </section>
      <section className={styles.formPane}>
        <form className={styles.form} onSubmit={onSubmit}>
          <h2>Create account</h2>
          <p className={styles.help}>Takes under a minute.</p>
          <label>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <PasswordField
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            autoComplete="new-password"
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <p className={styles.switch}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
