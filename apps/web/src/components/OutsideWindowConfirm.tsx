'use client';

/**
 * Two-step blocking dialog when dialing or scheduling outside the calling
 * window. Rendered on document.body so stacking contexts cannot hide it.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import type { CallingHoursMode } from '../domain/settings';
import type { CallingWindow } from '../domain/types';

export type OutsideWindowStep = 'idle' | 'ack' | 'final';

interface Props {
  window: CallingWindow;
  step: OutsideWindowStep;
  busy?: boolean;
  /**
   * Soft warns and continues after two confirmations. Strict refuses the dial
   * and tells the organizer to unset STRICT_CALLING_HOURS.
   */
  mode?: CallingHoursMode;
  /** What the final button does, e.g. "Call anyway" or "Schedule anyway". */
  confirmLabel: string;
  onAck: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Human label for a calling window, used in warnings. */
export function callingWindowLabel(window: CallingWindow): string {
  return `${window.start}-${window.end} ${window.timezone}`;
}

export function OutsideWindowConfirm({
  window,
  step,
  busy = false,
  mode = 'soft',
  confirmLabel,
  onAck,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const mounted = typeof document !== 'undefined';

  useEffect(() => {
    if (step === 'idle') return;
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
  }, [busy, step]);

  if (step === 'idle' || !mounted) return null;
  const hours = callingWindowLabel(window);
  const strict = mode === 'strict';
  const firstStep = step === 'ack';

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
        aria-labelledby="outside-window-title"
        aria-describedby="outside-window-body"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="outside-window-kicker">
          <Icon name="alert" /> Do not call yet
        </p>
        <h2 id="outside-window-title">
          {strict
            ? 'Calling hours are strict'
            : firstStep
              ? 'Outside calling hours'
              : 'Confirm the override'}
        </h2>
        <p id="outside-window-body">
          {strict
            ? `This server will not dial outside ${hours}. Unset STRICT_CALLING_HOURS and restart the server if you really need to call outside those hours.`
            : firstStep
              ? `Allowed hours are ${hours}. A call right now may disturb people. You must confirm twice to continue.`
              : `Last chance. You are about to dial outside ${hours}. This override is stored on the run.`}
        </p>
        <div className="outside-window-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            {strict ? 'Close' : 'Cancel'}
          </button>
          {strict ? null : firstStep ? (
            <button type="button" disabled={busy} onClick={onAck}>
              I understand the risk
            </button>
          ) : (
            <button
              type="button"
              className="outside-window-danger"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? 'Starting...' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Persistent strip when the page clock is already outside hours. */
export function OutsideWindowNotice({
  window,
  mode = 'soft',
}: {
  window: CallingWindow;
  mode?: CallingHoursMode;
}) {
  const hours = callingWindowLabel(window);
  return (
    <p className="outside-window-banner static">
      <Icon name="alert" /> Outside calling hours ({hours}).{' '}
      {mode === 'strict'
        ? 'Strict mode is on, so this call will not be placed. Unset STRICT_CALLING_HOURS if you really need to.'
        : 'Starting a call opens a blocking confirmation.'}
    </p>
  );
}
