'use client';

import { useEffect } from 'react';
import styles from './ConfirmModal.module.css';

export function ConfirmModal({
  open,
  title = 'Confirm',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape' && !busy) onCancel?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="presentation" onClick={() => !busy && onCancel?.()}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tracefix-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="tracefix-confirm-title">{title}</h2>
        {message ? <p>{message}</p> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? styles.danger : styles.confirm}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
