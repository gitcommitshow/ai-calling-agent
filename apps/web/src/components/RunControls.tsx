'use client';

/**
 * Run control for one campaign: start the saved queue now or at a chosen time,
 * watch who is on the phone, and stop or cancel. Outside calling hours needs a
 * double confirmation before anything is dialed or scheduled.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import {
  OutsideWindowConfirm,
  OutsideWindowNotice,
  type OutsideWindowStep,
} from './OutsideWindowConfirm';
import { RemoveQueueConfirm } from './RemoveQueueConfirm';
import { isWithinCallingWindow } from '../domain/eligibility';
import type { CallingHoursMode } from '../domain/settings';
import { formatInZone, isoToZonedInput, zonedInputToIso } from '../lib/time';
import {
  ATTEMPT_STATUS_LABELS,
  CALL_OUTCOME_LABELS,
  LIVE_RUN_STATUSES,
  RUN_STATUS_LABELS,
  type Attempt,
  type Campaign,
  type Guest,
  type Run,
} from '../domain/types';

const POLL_MS = 3000;

interface Props {
  campaign: Campaign;
  guests: Guest[];
  /** The most recent run for this campaign, so a reload keeps following it. */
  initialRun: Run | null;
  /** Strict refuses outside-hours dials. Soft opens the two-step confirmation. */
  callingHoursMode?: CallingHoursMode;
}

type PendingStart =
  | { kind: 'now' }
  | { kind: 'schedule'; startsAt: string; form: HTMLFormElement };

export function RunControls({ campaign, guests, initialRun, callingHoursMode = 'soft' }: Props) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(initialRun);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outsideStep, setOutsideStep] = useState<OutsideWindowStep>('idle');
  const [pending, setPending] = useState<PendingStart | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const timeZone = campaign.callingWindow.timezone;
  const outsideNow = !isWithinCallingWindow(now, campaign.callingWindow);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const guestName = useCallback(
    (guestId: string | null) =>
      guestId ? (guests.find((guest) => guest.id === guestId)?.name ?? guestId) : null,
    [guests],
  );

  const live = run !== null && LIVE_RUN_STATUSES.includes(run.status);
  const scheduled = run?.status === 'scheduled';
  const following = live || scheduled;

  const wasFollowing = useRef(following);
  useEffect(() => {
    if (wasFollowing.current && !following) router.refresh();
    wasFollowing.current = following;
  }, [following, router]);

  const runId = run?.id ?? null;
  useEffect(() => {
    if (!runId || !following) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
        const payload = (await response.json()) as {
          run?: Run;
          attempts?: Attempt[];
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error ?? 'could not read the run');
        if (payload.run) setRun(payload.run);
        setAttempts(payload.attempts ?? []);
      } catch (pollError) {
        if (!cancelled) setError((pollError as Error).message);
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [following, runId]);

  function clearOutsideGate() {
    setOutsideStep('idle');
    setPending(null);
  }

  /** POST a start or schedule, optionally with the outside-hours override. */
  async function postStart(body: Record<string, unknown>, failure: string, form?: HTMLFormElement) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { run?: Run; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? failure);
      setRun(payload.run);
      form?.reset();
      clearOutsideGate();
    } catch (postError) {
      setError((postError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function requestStartNow() {
    if (!isWithinCallingWindow(new Date(), campaign.callingWindow)) {
      setPending({ kind: 'now' });
      setOutsideStep('ack');
      return;
    }
    void postStart({}, 'could not start the run');
  }

  function requestSchedule(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const raw = String(new FormData(form).get('startsAt') ?? '').trim();
    if (!raw) {
      setError('Pick a time first.');
      return;
    }
    const startsAt = zonedInputToIso(raw, timeZone);
    const at = new Date(startsAt);
    if (!isWithinCallingWindow(at, campaign.callingWindow)) {
      setPending({ kind: 'schedule', startsAt, form });
      setOutsideStep('ack');
      return;
    }
    void postStart({ startsAt }, 'could not schedule the run', form);
  }

  async function confirmOutside() {
    if (!pending) return;
    if (pending.kind === 'now') {
      await postStart({ waiveCallingWindow: true }, 'could not start the run');
      return;
    }
    await postStart(
      { startsAt: pending.startsAt, waiveCallingWindow: true },
      'could not schedule the run',
      pending.form,
    );
  }

  /** Empty the saved queue while nothing is scheduled or dialing. */
  async function removeQueue() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queue: [] }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not remove the queue');
      setConfirmRemove(false);
      router.refresh();
    } catch (removeError) {
      setConfirmRemove(false);
      setError((removeError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stop(path: string, failure: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, { method: 'POST' });
      const payload = (await response.json()) as { run?: Run; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? failure);
      setRun(payload.run);
    } catch (stopError) {
      setError((stopError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = run?.currentAttemptId
    ? attempts.find((attempt) => attempt.id === run.currentAttemptId)
    : undefined;
  const settled = attempts.filter((attempt) => attempt.status === 'done');

  return (
    <div className="stack">
      {outsideNow && !live && !scheduled ? (
        <OutsideWindowNotice window={campaign.callingWindow} mode={callingHoursMode} />
      ) : null}

      {confirmRemove ? (
        <RemoveQueueConfirm
          campaignName={campaign.name}
          busy={busy}
          onCancel={() => {
            if (!busy) setConfirmRemove(false);
          }}
          onConfirm={() => void removeQueue()}
        />
      ) : null}

      <OutsideWindowConfirm
        window={campaign.callingWindow}
        step={outsideStep}
        busy={busy}
        mode={callingHoursMode}
        confirmLabel={pending?.kind === 'schedule' ? 'Schedule anyway' : 'Call anyway'}
        onAck={() => setOutsideStep('final')}
        onConfirm={() => void confirmOutside()}
        onCancel={clearOutsideGate}
      />

      <div className="toolbar-split">
        <span className="small muted queue-count">
          {!live && !scheduled && campaign.queue.length > 0 ? (
            <form
              method="get"
              action={`/events/${campaign.eventId}`}
              onSubmit={(formEvent) => {
                formEvent.preventDefault();
                setConfirmRemove(true);
              }}
            >
              <input type="hidden" name="removeQueue" value={campaign.id} />
              <button
                type="submit"
                className="icon-action"
                aria-label={`Remove ${campaign.name} queue`}
                disabled={busy || outsideStep !== 'idle' || confirmRemove}
              >
                <Icon name="xCircle" />
              </button>
            </form>
          ) : null}
          <Icon name="users" /> {campaign.queue.length} guests in the saved queue
        </span>
        <div className="toolbar">
          <button
            type="button"
            disabled={busy || live || scheduled || campaign.queue.length === 0 || outsideStep !== 'idle'}
            onClick={requestStartNow}
          >
            <Icon name="phone" /> {live ? 'Running...' : `Call all ${campaign.queue.length}`}
          </button>
          {scheduled && run ? (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void stop(`/api/runs/${run.id}/stop`, 'could not cancel the schedule')}
            >
              <Icon name="phoneOff" /> Stop
            </button>
          ) : (
            <button
              type="button"
              className="secondary"
              disabled={busy || !live || !run}
              onClick={() => run && void stop(`/api/runs/${run.id}/stop`, 'could not stop the run')}
            >
              <Icon name="ban" /> Stop
            </button>
          )}
        </div>
      </div>

      {scheduled && run?.scheduledFor ? (
        <p className="status-line">
          <Icon name="clock" />
          <span>
            Starts {formatInZone(run.scheduledFor, timeZone)}. Nothing is dialed until then.
            Cancel if you change your mind. Whoever is in the saved queue when that time arrives
            is who gets called.
          </span>
        </p>
      ) : null}

      {!live && !scheduled && campaign.queue.length > 0 ? (
        <>
          <form className="luma-row" onSubmit={(formEvent) => void requestSchedule(formEvent)}>
            <div className="grow">
              <label htmlFor="schedule-start">Or start at ({timeZone})</label>
              <input
                id="schedule-start"
                name="startsAt"
                type="datetime-local"
                required
                min={isoToZonedInput(new Date().toISOString(), timeZone)}
                disabled={outsideStep !== 'idle'}
              />
            </div>
            <button type="submit" disabled={busy || outsideStep !== 'idle'}>
              <Icon name="clock" /> {busy ? 'Scheduling...' : 'Schedule'}
            </button>
          </form>
          <p className="small muted">
            Nothing is dialed until the time you pick. Cancel before then if you change your mind.
          </p>
        </>
      ) : null}

      {campaign.queue.length === 0 ? (
        <p className="empty">
          Nothing to call yet. Build and save the queue on the event page first.
        </p>
      ) : null}

      {run ? (
        <div className="stack">
          <div className="toolbar">
            <span className="chip strong">
              {live ? <span className="live-dot" /> : <Icon name={scheduled ? 'clock' : 'list'} />}{' '}
              {RUN_STATUS_LABELS[run.status]}
            </span>
            <span className="chip">
              <Icon name="phone" /> {settled.length} of {run.guestIds.length} called
            </span>
            {run.skipped.length > 0 ? (
              <span className="chip">
                <Icon name="ban" /> {run.skipped.length} skipped
              </span>
            ) : null}
            {run.waiveCallingWindow ? (
              <span className="chip">
                <Icon name="alert" /> outside-hours override
              </span>
            ) : null}
            {run.kind === 'single' ? (
              <span className="chip">
                <Icon name="users" /> one guest
              </span>
            ) : null}
          </div>

          {current ? (
            <p className="status-line ok">
              <Icon name="phone" />
              <span>
                {ATTEMPT_STATUS_LABELS[current.status]}: {guestName(current.guestId)}
              </span>
            </p>
          ) : live ? (
            <p className="status-line">
              <Icon name="clock" />
              <span>Between calls</span>
            </p>
          ) : null}

          {settled.length > 0 ? (
            <ol className="queue-list">
              {settled.map((attempt) => (
                <li key={attempt.id}>
                  <Icon name="check" />
                  <span className="truncate">{guestName(attempt.guestId)}</span>
                  <span className="small muted">
                    {attempt.outcome ? CALL_OUTCOME_LABELS[attempt.outcome] : 'no outcome'}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {run.skipped.length > 0 ? (
            <ol className="queue-list">
              {run.skipped.map((skip) => (
                <li key={skip.guestId}>
                  <Icon name="ban" />
                  <span className="truncate">{guestName(skip.guestId)}</span>
                  <span className="small muted">{skip.reason}</span>
                </li>
              ))}
            </ol>
          ) : null}

          {run.error ? (
            <p className="status-line blocked">
              <Icon name="alert" />
              <span>{run.error}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="notice error small">
          <Icon name="alert" /> {error}
        </p>
      ) : null}
    </div>
  );
}
