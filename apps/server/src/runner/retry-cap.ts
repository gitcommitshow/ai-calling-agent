/**
 * Per-guest attempt limits. A missing guest uses the campaign's retry cap,
 * which is the default for everyone on that campaign. Keep the lookup in step
 * with apps/web/src/domain/retry-cap.ts.
 */

/** Highest attempt limit an organizer can set, for one guest or a whole campaign. */
export const MAX_GUEST_ATTEMPTS = 5;

/** Keep a stored limit inside 1..MAX_GUEST_ATTEMPTS. Values above the ceiling clamp down. */
export function clampGuestAttempts(value: number, fallback = 1): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(MAX_GUEST_ATTEMPTS, Math.max(1, value));
}

/** Attempts this guest may have. A saved override replaces the campaign default. */
export function retryCapForGuest(
  campaign: { retryCap: number; retryCapOverrides?: Record<string, number> },
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
 * Null clears the override.
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

/** Keep limits only for guests still on the event. Undefined when none remain. */
export function retryCapOverridesForGuests(
  overrides: Record<string, number> | undefined,
  guestIds: ReadonlySet<string>,
): Record<string, number> | undefined {
  if (!overrides) return undefined;
  const next: Record<string, number> = {};
  for (const [guestId, cap] of Object.entries(overrides)) {
    if (guestIds.has(guestId)) next[guestId] = cap;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** True when both maps would allow the same guests the same number of attempts. */
export function sameRetryCapOverrides(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
): boolean {
  const a = left ?? {};
  const b = right ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
