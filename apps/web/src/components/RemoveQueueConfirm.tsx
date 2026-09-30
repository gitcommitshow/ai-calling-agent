'use client';

/**
 * Blocking confirm before a saved queue is emptied. The icon alone must not
 * clear the list, because that click is easy to hit by accident.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  campaignName: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RemoveQueueConfirm({ campaignName, busy = false, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const mounted = typeof document !== 'undefined';

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [busy]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="outside-window-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="outside-window-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-queue-title"
        aria-describedby="remove-queue-body"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="remove-queue-title">Remove this queue?</h2>
        <p id="remove-queue-body">
          {campaignName} will no longer be waiting to call. The campaign stays. Guests come off
          the list.
        </p>
        <div className="outside-window-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="button" className="outside-window-danger" disabled={busy} onClick={onConfirm}>
            {busy ? 'Removing...' : 'Remove'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
