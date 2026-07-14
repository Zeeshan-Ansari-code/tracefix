'use client';

import { useState } from 'react';
import styles from '../../app/auth.module.css';

export function PasswordField({
  value,
  onChange,
  label = 'Password',
  minLength,
  required = true,
  autoComplete = 'current-password',
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label>
      <span>{label}</span>
      <div className={styles.passwordWrap}>
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          minLength={minLength}
          required={required}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className={styles.eyeBtn}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </label>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-4.4M9.9 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-3.2 4.1M6.1 6.1C3.7 7.8 2 12 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
