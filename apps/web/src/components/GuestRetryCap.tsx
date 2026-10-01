'use client';

/**
 * Attempt limit for one guest. The slider replaces the campaign default.
 * Sliding back to that default clears the personal limit. The fraction and
 * the outcome glyph are the readout. Longer explanation stays on hover.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { CALL_OUTCOME_ICONS } from './status-icons';
import type { GuestAttemptSnapshot } from '../domain/eligibility';
import { clampGuestAttempts, MAX_GUEST_ATTEMPTS } from '../domain/retry-cap';
import { CALL_OUTCOME_LABELS } from '../domain/types';

interface Props {
  campaignId: string;
  guestId: string;
  guestName: string;
  /** Campaign retry cap. Matching it on the slider follows that default again. */
  campaignDefault: number;
  /** Saved override. Absent when this guest follows the campaign default. */
  override?: number;
  attempts: number;
  /** Newest call on this campaign, when there is one. */
  latest: GuestAttemptSnapshot | null;
  /** Called after a successful save so the list can update before reload. */
  onSaved?: (retryCap: number | null) => void;
}

/** Hover text: call result, how many attempts are used, and how the slider works. */
function attemptDetail(options: {
  guestName: string;
  attempts: number;
  allowed: number;
  campaignDefault: number;
  usingDefault: boolean;
  latest: GuestAttemptSnapshot | null;
}): string {
  const result = !options.latest
    ? 'No call yet.'
    : options.latest.status !== 'done'
      ? 'Call in progress.'
      : options.latest.outcome
        ? `Latest call: ${CALL_OUTCOME_LABELS[options.latest.outcome]}.`
        : 'Latest call finished without an outcome.';
  const limit = options.usingDefault
    ? `${options.allowed} allowed, the campaign default.`
    : `${options.allowed} allowed for ${options.guestName}. Campaign default is ${options.campaignDefault}.`;
  return `${result} ${options.attempts} of ${options.allowed} used. ${limit} Slide from 1 to ${MAX_GUEST_ATTEMPTS}. Matching the campaign default follows it again.`;
}

export function GuestRetryCap({
  campaignId,
  guestId,
  guestName,
  campaignDefault,
  override,
  attempts,
  latest,
  onSaved,
}: Props) {
  const router = useRouter();
  const ceilingDefault = clampGuestAttempts(campaignDefault);
  const [applied, setApplied] = useState<number | undefined>(override);
  const usingDefault = applied === undefined;
  const [draft, setDraft] = useState(clampGuestAttempts(override ?? ceilingDefault));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const inputId = `retry-cap-${campaignId}-${guestId}`;
  const allowed = clampGuestAttempts(draft);

  useEffect(() => {
    setApplied(override);
    setDraft(clampGuestAttempts(override ?? clampGuestAttempts(campaignDefault)));
  }, [override, campaignDefault, campaignId, guestId]);

  /** Persist a limit, or null to follow the campaign default again. */
  async function persist(retryCap: number | null) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/guests/${encodeURIComponent(guestId)}/retry-cap`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ retryCap }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not save the attempt limit');
      setApplied(retryCap === null ? undefined : retryCap);
      setDraft(retryCap === null ? ceilingDefault : retryCap);
      onSaved?.(retryCap);
      router.refresh();
    } catch (saveError) {
      setDraft(applied ?? ceilingDefault);
      setError((saveError as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  /** Save when the slider stopped on a new number. Matching the default clears the override. */
  function commit(value: number) {
    const parsed = clampGuestAttempts(value);
    setDraft(parsed);
    if (usingDefault && parsed === ceilingDefault) return;
    if (!usingDefault && parsed === applied) return;
    void persist(parsed === ceilingDefault ? null : parsed);
  }

  const detail = attemptDetail({
    guestName,
    attempts,
    allowed,
    campaignDefault: ceilingDefault,
    usingDefault,
    latest,
  });
  const meterClass = [
    'attempt-meter',
    usingDefault ? '' : 'custom',
    attempts > 0 && attempts >= allowed ? 'full' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="retry-cap" title={detail}>
      <span className={meterClass} title={detail} aria-label={detail}>
        <CallSignal latest={latest} />
        <span className="attempt-fraction">
          {attempts}/{allowed}
        </span>
      </span>
      <input
        id={inputId}
        type="range"
        min={1}
        max={MAX_GUEST_ATTEMPTS}
        step={1}
        aria-label={`Attempts allowed for ${guestName}`}
        value={allowed}
        disabled={busy}
        onChange={(changeEvent) => setDraft(clampGuestAttempts(Number(changeEvent.target.value)))}
        onPointerUp={(pointerEvent) => commit(Number(pointerEvent.currentTarget.value))}
        onKeyUp={(keyEvent) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(keyEvent.key)) {
            return;
          }
          commit(Number(keyEvent.currentTarget.value));
        }}
        onBlur={(blurEvent) => commit(Number(blurEvent.currentTarget.value))}
      />
      {usingDefault ? null : (
        <button
          type="button"
          className="icon-button"
          aria-label={`Use campaign default (${ceilingDefault})`}
          title={`Use campaign default (${ceilingDefault})`}
          disabled={busy}
          onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
          onClick={() => {
            setDraft(ceilingDefault);
            void persist(null);
          }}
        >
          <Icon name="undo" />
        </button>
      )}
      {error ? (
        <span className="retry-cap-error" title={error}>
          Not saved
        </span>
      ) : null}
    </div>
  );
}

/** Glyph for the newest call. Absent when this campaign has not dialed the guest. */
function CallSignal({ latest }: { latest: GuestAttemptSnapshot | null }) {
  if (!latest) return null;
  if (latest.status !== 'done') return <span className="live-dot" />;
  const outcome = latest.outcome ?? 'failed';
  return <Icon name={CALL_OUTCOME_ICONS[outcome]} className={`attempt-outcome ${outcome}`} />;
}
