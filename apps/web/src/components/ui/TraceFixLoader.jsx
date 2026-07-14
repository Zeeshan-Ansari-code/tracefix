'use client';

import { TraceFixMark } from '../brand/TraceFixMark.jsx';
import styles from './TraceFixLoader.module.css';

/**
 * Full-screen or inline branded loader.
 * @param {{ label?: string, fullScreen?: boolean, size?: number }} props
 */
export function TraceFixLoader({
  label = 'Loading TraceFix',
  fullScreen = false,
  size = 56,
}) {
  return (
    <div
      className={fullScreen ? styles.fullScreen : styles.inline}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className={styles.stage} style={{ width: size + 28, height: size + 28 }}>
        <span className={styles.ring} aria-hidden="true" />
        <span className={styles.ringDelay} aria-hidden="true" />
        <span className={styles.orbit} aria-hidden="true">
          <span className={styles.dot} />
        </span>
        <div className={styles.mark}>
          <TraceFixMark size={size} />
        </div>
      </div>
      {label ? (
        <p className={styles.label}>
          <span className={styles.labelText}>{label}</span>
          <span className={styles.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </p>
      ) : null}
    </div>
  );
}
