/**
 * Runtime guardrails the runner checks immediately before every dial. The web
 * app reports the same rules on the guest list (apps/web/src/domain/eligibility.ts),
 * but these are the ones that actually decide, because a saved queue can go
 * stale between the organizer pressing start and the guest being reached.
 */
import type { AttemptRecord, CampaignRecord, EventRecord, GuestRecord } from '../storage/types.ts';

export type Guardrail = { ok: true } | { ok: false; reason: string };

/** Local wall-clock time in the window's timezone, as HH:MM. */
export function localClockTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

export function isWithinCallingWindow(now: Date, window: CampaignRecord['callingWindow']): boolean {
  const time = localClockTime(now, window.timezone);
  return time >= window.start && time < window.end;
}

/**
 * Why a chosen start time cannot dial this campaign. Null when that instant
 * is inside the pre-event or post-event rule and the daily calling window.
 */
export function scheduleBlockReason(
  event: EventRecord,
  campaign: CampaignRecord,
  at: Date,
): string | null {
  if (campaign.type === 'pre-event' && at >= new Date(event.startsAt)) {
    return 'that time is after the event starts';
  }
  if (campaign.type === 'post-event' && at <= new Date(event.endsAt)) {
    return 'that time is before the event ends';
  }
  if (!isWithinCallingWindow(at, campaign.callingWindow)) {
    const { start, end, timezone } = campaign.callingWindow;
    return `that time is outside the calling window (${start}-${end} ${timezone})`;
  }
  return null;
}

/** Attempts already made per guest for one campaign, for the retry cap. */
export function countAttemptsByGuest(
  attempts: AttemptRecord[],
  campaignId: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const attempt of attempts) {
    if (attempt.campaignId !== campaignId) continue;
    counts[attempt.guestId] = (counts[attempt.guestId] ?? 0) + 1;
  }
  return counts;
}

export interface GuardrailContext {
  event: EventRecord;
  campaign: CampaignRecord;
  attemptsByGuest: Record<string, number>;
  now: Date;
  /** Set only for an organizer follow-up on an open question. */
  waiveRetryCap?: boolean;
}

/** One guest against one campaign. The first failing rule is the reason stored. */
export function checkGuardrails(guest: GuestRecord, ctx: GuardrailContext): Guardrail {
  const { event, campaign, attemptsByGuest, now } = ctx;

  if (!guest.phone) return { ok: false, reason: 'no usable phone number' };
  // Same rule as the guest list: other countries are stored, not dialed yet.
  if (!/^\+91[6-9]\d{9}$/.test(guest.phone)) {
    return { ok: false, reason: 'calling outside India is not available yet' };
  }
  if (!campaign.queue.includes(guest.id)) {
    return { ok: false, reason: 'not in the campaign queue' };
  }

  if (campaign.type === 'pre-event' && now >= new Date(event.startsAt)) {
    return { ok: false, reason: 'the event has already started' };
  }
  if (campaign.type === 'post-event' && now <= new Date(event.endsAt)) {
    return { ok: false, reason: 'the event has not ended yet' };
  }

  const attempts = attemptsByGuest[guest.id] ?? 0;
  if (!ctx.waiveRetryCap && attempts >= campaign.retryCap) {
    return { ok: false, reason: `retry cap reached (${attempts}/${campaign.retryCap})` };
  }

  if (!isWithinCallingWindow(now, campaign.callingWindow)) {
    const { start, end, timezone } = campaign.callingWindow;
    return { ok: false, reason: `outside the calling window (${start}-${end} ${timezone})` };
  }

  return { ok: true };
}
