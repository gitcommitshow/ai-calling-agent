/**
 * Call eligibility policy. This reports it: the guest list shows why a guest
 * cannot be called. The runner enforces the same rules immediately before every
 * dial (apps/server/src/runner/guardrails.ts), because a saved queue can go
 * stale between pressing start and reaching the guest.
 */
import { canCallPhone } from './phone';
import type { Campaign, Event, Guest } from './types';

export type Eligibility = { eligible: true } | { eligible: false; reason: string };

export interface EligibilityContext {
  event: Event;
  campaign: Campaign;
  /** Attempts already made per guest for this campaign, for the retry cap. */
  attemptsByGuest: Record<string, number>;
  now: Date;
  /** Set only for an organizer follow-up on an open question. */
  waiveRetryCap?: boolean;
}

/** Local wall-clock time in the window's timezone, as HH:MM. */
export function localClockTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  // Always zero-pad: bare "9:30" string-compares as after "10:00".
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

export function isWithinCallingWindow(now: Date, window: Campaign['callingWindow']): boolean {
  const time = localClockTime(now, window.timezone);
  return time >= window.start && time < window.end;
}

/** One guest against one campaign. The first failing rule is the reason shown. */
export function checkEligibility(guest: Guest, ctx: EligibilityContext): Eligibility {
  const { event, campaign, attemptsByGuest, now } = ctx;

  if (!guest.phone) return { eligible: false, reason: 'no usable phone number' };
  if (!canCallPhone(guest.phone)) {
    return { eligible: false, reason: 'calling outside India is not available yet' };
  }
  if (!campaign.queue.includes(guest.id)) {
    return { eligible: false, reason: 'not in the campaign queue' };
  }

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  if (campaign.type === 'pre-event' && now >= startsAt) {
    return { eligible: false, reason: 'the event has already started' };
  }
  if (campaign.type === 'post-event' && now <= endsAt) {
    return { eligible: false, reason: 'the event has not ended yet' };
  }

  const attempts = attemptsByGuest[guest.id] ?? 0;
  if (!ctx.waiveRetryCap && attempts >= campaign.retryCap) {
    return { eligible: false, reason: `retry cap reached (${attempts}/${campaign.retryCap})` };
  }

  if (!isWithinCallingWindow(now, campaign.callingWindow)) {
    const { start, end, timezone } = campaign.callingWindow;
    return { eligible: false, reason: `outside the calling window (${start}-${end} ${timezone})` };
  }

  return { eligible: true };
}

/** Attempt counts per guest, keyed for the eligibility context. */
export function countAttemptsByGuest(
  attempts: { campaignId: string; guestId: string }[],
  campaignId: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const attempt of attempts) {
    if (attempt.campaignId !== campaignId) continue;
    counts[attempt.guestId] = (counts[attempt.guestId] ?? 0) + 1;
  }
  return counts;
}
