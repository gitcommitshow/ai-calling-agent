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

export function isWithinCallingWindow(now: Date, window: CampaignRecord['callingWindow']): boolean {
  const time = localClockTime(now, window.timezone);
  return time >= window.start && time < window.end;
}

/** How a refusal is phrased: a start, a per-guest check, or a chosen schedule time. */
export type CallingWindowRefusalKind = 'start' | 'now' | 'schedule';

/**
 * Why this instant is outside calling hours, or null when the check does not apply.
 * Strict mode ignores a confirmed override and tells the organizer which env var to unset.
 */
export function callingWindowRefusal(
  window: CampaignRecord['callingWindow'],
  options: { strictCallingHours?: boolean; kind: CallingWindowRefusalKind },
): string {
  const hours = `${window.start}-${window.end} ${window.timezone}`;
  if (options.strictCallingHours) {
    const lead =
      options.kind === 'schedule'
        ? `that time is outside the calling window (${hours})`
        : `outside the calling window (${hours})`;
    return `${lead}. Calling hours are strict on this server (STRICT_CALLING_HOURS). Unset that variable and restart the server if you really need to call outside those hours.`;
  }
  if (options.kind === 'schedule') return `that time is outside the calling window (${hours})`;
  if (options.kind === 'start') {
    return `outside the calling window (${hours}). Confirm an override to call anyway.`;
  }
  return `outside the calling window (${hours})`;
}

/**
 * Why a chosen start time cannot dial this campaign. Null when that instant
 * is inside the pre-event or post-event rule and the daily calling window.
 * `waiveCallingWindow` skips the daily hours check only when the server is not
 * in strict mode. Event timing still holds either way.
 */
export function scheduleBlockReason(
  event: EventRecord,
  campaign: CampaignRecord,
  at: Date,
  options: { waiveCallingWindow?: boolean; strictCallingHours?: boolean } = {},
): string | null {
  if (campaign.type === 'pre-event' && at >= new Date(event.startsAt)) {
    return 'that time is after the event starts';
  }
  if (campaign.type === 'post-event' && at <= new Date(event.endsAt)) {
    return 'that time is before the event ends';
  }
  const waived = options.waiveCallingWindow === true && options.strictCallingHours !== true;
  if (!waived && !isWithinCallingWindow(at, campaign.callingWindow)) {
    return callingWindowRefusal(campaign.callingWindow, {
      strictCallingHours: options.strictCallingHours,
      kind: 'schedule',
    });
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
  /**
   * Set only after the organizer double-confirmed a dial outside calling hours.
   * Ignored when `strictCallingHours` is set. Event timing and retry caps still apply.
   */
  waiveCallingWindow?: boolean;
  /** From STRICT_CALLING_HOURS. Outside hours is refused even after a confirmation. */
  strictCallingHours?: boolean;
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

  const waived = ctx.waiveCallingWindow === true && ctx.strictCallingHours !== true;
  if (!waived && !isWithinCallingWindow(now, campaign.callingWindow)) {
    return {
      ok: false,
      reason: callingWindowRefusal(campaign.callingWindow, {
        strictCallingHours: ctx.strictCallingHours,
        kind: 'now',
      }),
    };
  }

  return { ok: true };
}
