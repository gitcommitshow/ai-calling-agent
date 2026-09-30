'use client';

/**
 * One low bar per queue that already has guests, shown inside the call queue.
 * A warm bar is waiting for a person. A green bar will call unless it is stopped.
 * Outside calling hours needs a double confirmation before dialing or scheduling.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import {
  OutsideWindowConfirm,
  OutsideWindowNotice,
  type OutsideWindowStep,
} from './OutsideWindowConfirm';
import { isWithinCallingWindow } from '../domain/eligibility';
import type { CallingHoursMode } from '../domain/settings';
import { summarizeSkips } from '../domain/run-skips';
import { formatInZone, isoToZonedInput, zonedInputToIso } from '../lib/time';
import { LIVE_RUN_STATUSES, type Campaign, type Run } from '../domain/types';

const POLL_MS = 3000;

type BarTone = 'pending' | 'armed' | 'live';

interface Props {
  eventId: string;
  campaigns: Campaign[];
  /** Newest first, same order the event page already loaded. */
  runs: Run[];
  /** Strict refuses outside-hours dials. Soft opens the two-step confirmation. */
  callingHoursMode?: CallingHoursMode;
}

type PendingAction =
  | { campaignId: string; kind: 'now' }
  | { campaignId: string; kind: 'schedule'; startsAt: string };

/** A run the page should keep watching until it settles. */
function isOpen(run: Run | null): run is Run {
  return run !== null && (LIVE_RUN_STATUSES.includes(run.status) || run.status === 'scheduled');
}

/** pending needs a person. armed will dial on its own. live is already dialing. */
function barTone(run: Run | null): BarTone {
  if (run !== null && LIVE_RUN_STATUSES.includes(run.status)) return 'live';
  if (run?.status === 'scheduled') return 'armed';
  return 'pending';
}

export function CampaignQuickCalls({
  eventId,
  campaigns,
  runs,
  callingHoursMode = 'soft',
}: Props) {
  const router = useRouter();
  const ready = campaigns.filter((campaign) => campaign.queue.length > 0);
  const [overrides, setOverrides] = useState<Record<string, Run>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [minByZone, setMinByZone] = useState<Record<string, string>>({});
  const [outsideStep, setOutsideStep] = useState<OutsideWindowStep>('idle');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function runFor(campaignId: string): Run | null {
    return overrides[campaignId] ?? runs.find((run) => run.campaignId === campaignId) ?? null;
  }

  const openIds = ready
    .map((campaign) => runFor(campaign.id))
    .filter(isOpen)
    .map((run) => run.id);
  const openKey = openIds.join(',');

  const zones = ready.map((campaign) => campaign.callingWindow.timezone).join('|');
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const zone of new Set(zones.split('|').filter(Boolean))) {
      next[zone] = isoToZonedInput(new Date().toISOString(), zone);
    }
    setMinByZone(next);
  }, [zones]);

  const wasOpen = useRef<string[]>([]);
  useEffect(() => {
    const current = openKey ? openKey.split(',') : [];
    if (wasOpen.current.some((id) => !current.includes(id))) router.refresh();
    wasOpen.current = current;
  }, [openKey, router]);

  useEffect(() => {
    if (!openKey) return;
    const ids = openKey.split(',');
    let cancelled = false;

    const tick = async () => {
      await Promise.all(
        ids.map(async (runId) => {
          try {
            const response = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
            const payload = (await response.json()) as { run?: Run; error?: string };
            if (cancelled || !response.ok || !payload.run) return;
            setOverrides((current) => ({ ...current, [payload.run!.campaignId]: payload.run! }));
          } catch {
            // The next tick retries. A single miss should not cover the row.
          }
        }),
      );
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [openKey]);

  function clearOutsideGate() {
    setOutsideStep('idle');
    setPending(null);
  }

  async function postRun(campaign: Campaign, body: Record<string, unknown>, failure: string) {
    setBusyId(campaign.id);
    setErrors((current) => ({ ...current, [campaign.id]: '' }));
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { run?: Run; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? failure);
      setOverrides((current) => ({ ...current, [campaign.id]: payload.run! }));
      clearOutsideGate();
      if (!isOpen(payload.run)) router.refresh();
    } catch (postError) {
      setErrors((current) => ({ ...current, [campaign.id]: (postError as Error).message }));
    } finally {
      setBusyId((current) => (current === campaign.id ? null : current));
    }
  }

  function requestNow(campaign: Campaign) {
    if (!isWithinCallingWindow(new Date(), campaign.callingWindow)) {
      setPending({ campaignId: campaign.id, kind: 'now' });
      setOutsideStep('ack');
      return;
    }
    void postRun(campaign, {}, 'could not start the run');
  }

  function requestSchedule(campaign: Campaign, form: HTMLFormElement) {
    const raw = String(new FormData(form).get('startsAt') ?? '').trim();
    if (!raw) {
      setErrors((current) => ({ ...current, [campaign.id]: 'Pick a time first.' }));
      return;
    }
    const startsAt = zonedInputToIso(raw, campaign.callingWindow.timezone);
    if (!isWithinCallingWindow(new Date(startsAt), campaign.callingWindow)) {
      setPending({ campaignId: campaign.id, kind: 'schedule', startsAt });
      setOutsideStep('ack');
      return;
    }
    void postRun(campaign, { startsAt }, 'could not schedule the run');
  }

  async function confirmOutside() {
    if (!pending) return;
    const campaign = ready.find((item) => item.id === pending.campaignId);
    if (!campaign) return;
    if (pending.kind === 'now') {
      await postRun(campaign, { waiveCallingWindow: true }, 'could not start the run');
      return;
    }
    await postRun(
      campaign,
      { startsAt: pending.startsAt, waiveCallingWindow: true },
      'could not schedule the run',
    );
  }

  async function stop(campaignId: string, run: Run) {
    setBusyId(campaignId);
    setErrors((current) => ({ ...current, [campaignId]: '' }));
    try {
      const response = await fetch(`/api/runs/${run.id}/stop`, { method: 'POST' });
      const payload = (await response.json()) as { run?: Run; error?: string };
      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? 'could not stop the run');
      }
      setOverrides((current) => ({ ...current, [campaignId]: payload.run! }));
    } catch (stopError) {
      setErrors((current) => ({ ...current, [campaignId]: (stopError as Error).message }));
    } finally {
      setBusyId((current) => (current === campaignId ? null : current));
    }
  }

  if (ready.length === 0) return null;

  const pendingCampaign = pending
    ? ready.find((campaign) => campaign.id === pending.campaignId)
    : undefined;
  const anyOutside = ready.some(
    (campaign) => barTone(runFor(campaign.id)) === 'pending' && !isWithinCallingWindow(now, campaign.callingWindow),
  );

  return (
    <div>
      <p className="small muted">
        Warm bars are waiting for you. Green bars will call on their own. Stop one if you change your mind.
      </p>
      {anyOutside ? (
        <OutsideWindowNotice
          window={ready.find((c) => !isWithinCallingWindow(now, c.callingWindow))!.callingWindow}
          mode={callingHoursMode}
        />
      ) : null}
      {pendingCampaign ? (
        <OutsideWindowConfirm
          window={pendingCampaign.callingWindow}
          step={outsideStep}
          busy={busyId === pendingCampaign.id}
          mode={callingHoursMode}
          confirmLabel={pending?.kind === 'schedule' ? 'Schedule anyway' : 'Call anyway'}
          onAck={() => setOutsideStep('final')}
          onConfirm={() => void confirmOutside()}
          onCancel={clearOutsideGate}
        />
      ) : null}
      <ul className="queue-bars">
        {ready.map((campaign) => {
          const run = runFor(campaign.id);
          const tone = barTone(run);
          const busy = busyId === campaign.id;
          const timeZone = campaign.callingWindow.timezone;
          const error = errors[campaign.id];
          const count = `${campaign.queue.length} queued`;
          const gating = outsideStep !== 'idle';

          return (
            <li key={campaign.id}>
              <div className={`queue-bar ${tone}`}>
                <Link href={`/events/${eventId}/campaigns/${campaign.id}`} className="queue-bar-name truncate">
                  {campaign.name}
                </Link>
                {tone === 'live' ? (
                  <span className="queue-bar-state">
                    <span className="live-dot" /> Calling now
                  </span>
                ) : tone === 'armed' && run?.scheduledFor ? (
                  <span className="queue-bar-state">
                    {count}. Will call {formatInZone(run.scheduledFor, timeZone)}
                  </span>
                ) : (
                  <span className="queue-bar-state">{count}. Needs a start</span>
                )}

                {tone === 'pending' ? (
                  <div className="queue-bar-actions">
                    <form
                      method="get"
                      action={`/events/${eventId}`}
                      onSubmit={(formEvent) => {
                        formEvent.preventDefault();
                        requestNow(campaign);
                      }}
                    >
                      <input type="hidden" name="confirm" value={campaign.id} />
                      <input type="hidden" name="step" value="1" />
                      <button
                        type="submit"
                        className="icon-action"
                        aria-label={`Call ${campaign.name} now`}
                        disabled={busy || gating}
                      >
                        <Icon name="phone" />
                      </button>
                    </form>
                    <form
                      method="get"
                      action={`/events/${eventId}`}
                      onSubmit={(formEvent) => {
                        formEvent.preventDefault();
                        requestSchedule(campaign, formEvent.currentTarget);
                      }}
                    >
                      <input type="hidden" name="confirm" value={campaign.id} />
                      <input type="hidden" name="step" value="1" />
                      <input
                        name="startsAt"
                        type="datetime-local"
                        aria-label={`Start ${campaign.name} (${timeZone})`}
                        min={minByZone[timeZone] || undefined}
                        disabled={gating}
                      />
                      <button
                        type="submit"
                        className="icon-action"
                        aria-label={`Schedule ${campaign.name}`}
                        disabled={busy || gating}
                      >
                        <Icon name="clock" />
                      </button>
                    </form>
                  </div>
                ) : run ? (
                  <div className="queue-bar-actions">
                    <button
                      type="button"
                      className="stop-action"
                      aria-label={`Stop ${campaign.name}`}
                      disabled={busy}
                      onClick={() => void stop(campaign.id, run)}
                    >
                      <Icon name="phoneOff" /> Stop
                    </button>
                  </div>
                ) : null}
              </div>
              {run && run.skipped.length > 0 ? (
                <p className="status-line blocked queue-bar-error">
                  <Icon name="ban" />
                  <span>{summarizeSkips(run.skipped).join('. ')}</span>
                </p>
              ) : null}
              {error ? (
                <p className="notice error small queue-bar-error">
                  <Icon name="alert" /> {error}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
