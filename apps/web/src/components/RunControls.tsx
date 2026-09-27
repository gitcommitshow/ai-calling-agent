'use client';

/**
 * Run control for one campaign: start the saved queue, watch who is on the
 * phone right now, and stop early. Polls only while a run is live, so an idle
 * page makes no requests.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
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
}

export function RunControls({ campaign, guests, initialRun }: Props) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(initialRun);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guestName = useCallback(
    (guestId: string | null) =>
      guestId ? (guests.find((guest) => guest.id === guestId)?.name ?? guestId) : null,
    [guests],
  );

  const live = run !== null && LIVE_RUN_STATUSES.includes(run.status);

  // Refresh the server-rendered parts of the page once a run settles, so the
  // results and attempt counts elsewhere stop being stale.
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) router.refresh();
    wasLive.current = live;
  }, [live, router]);

  // Keyed on the run id, not the run object, so one interval covers the whole
  // run instead of being torn down and rebuilt on every poll.
  const runId = run?.id ?? null;
  useEffect(() => {
    if (!runId || !live) return;

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
  }, [live, runId]);

  async function send(path: string, failure: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, { method: 'POST' });
      const payload = (await response.json()) as { run?: Run; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? failure);
      setRun(payload.run);
    } catch (sendError) {
      setError((sendError as Error).message);
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
      <div className="toolbar-split">
        <span className="small muted">
          <Icon name="users" /> {campaign.queue.length} guests in the saved queue
        </span>
        <div className="toolbar">
          <button
            type="button"
            disabled={busy || live || campaign.queue.length === 0}
            onClick={() => send(`/api/campaigns/${campaign.id}/runs`, 'could not start the run')}
          >
            <Icon name="phone" /> {live ? 'Running...' : `Call all ${campaign.queue.length}`}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !live || !run}
            onClick={() => run && send(`/api/runs/${run.id}/stop`, 'could not stop the run')}
          >
            <Icon name="ban" /> Stop
          </button>
        </div>
      </div>

      {campaign.queue.length === 0 ? (
        <p className="empty">
          Nothing to call yet. Build and save the queue on the event page first.
        </p>
      ) : null}

      {run ? (
        <div className="stack">
          <div className="toolbar">
            <span className="chip strong">
              {live ? <span className="live-dot" /> : <Icon name="list" />}{' '}
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
