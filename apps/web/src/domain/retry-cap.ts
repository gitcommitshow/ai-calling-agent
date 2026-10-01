/**
 * Per-guest attempt limits. A missing guest uses the campaign's retry cap,
 * which is the default for everyone on that campaign. Keep the lookup in step
 * with apps/server/src/runner/retry-cap.ts.
 */
import type { Campaign } from './types';

/** Highest attempt limit an organizer can set, for one guest or a whole campaign. */
export const MAX_GUEST_ATTEMPTS = 5;

/** Keep a stored or typed limit inside 1..MAX_GUEST_ATTEMPTS. */
export function clampGuestAttempts(value: number): number {
  if (!Number.isInteger(value)) return 1;
  return Math.min(MAX_GUEST_ATTEMPTS, Math.max(1, value));
}

/** Attempts this guest may have. A saved override replaces the campaign default. */
export function retryCapForGuest(
  campaign: Pick<Campaign, 'retryCap' | 'retryCapOverrides'>,
  guestId: string,
): number {
  const override = campaign.retryCapOverrides?.[guestId];
  if (
    typeof override === 'number' &&
    Number.isInteger(override) &&
    override >= 1 &&
    override <= MAX_GUEST_ATTEMPTS
  ) {
    return override;
  }
  return clampGuestAttempts(campaign.retryCap);
}

/**
 * Remember one guest's attempt limit, or forget it so the campaign default applies again.
 * Null clears the override. Used to update the guest list before the page reloads.
 */
export function withGuestRetryCap(
  overrides: Record<string, number> | undefined,
  guestId: string,
  retryCap: number | null,
): Record<string, number> | undefined {
  const next = { ...(overrides ?? {}) };
  if (retryCap === null) delete next[guestId];
  else next[guestId] = retryCap;
  return Object.keys(next).length > 0 ? next : undefined;
}
