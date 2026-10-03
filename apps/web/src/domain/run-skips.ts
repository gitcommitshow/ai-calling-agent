/**
 * How a finished or live run explains guests it did not dial. The runner stores
 * one reason per guest; the queue bar and guest cards read it from here.
 */
import type { Run } from './types';

/** One line per distinct reason, with a count when several guests share it. */
export function summarizeSkips(skipped: { reason: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const skip of skipped) {
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) =>
    count === 1 ? `Skipped: ${reason}` : `Skipped ${count}: ${reason}`,
  );
}

/** Skip reason from the newest run of this campaign, keyed by guest id. */
export function latestSkipByGuest(runs: Run[], campaignId: string): Map<string, string> {
  const latest = runs
    .filter((run) => run.campaignId === campaignId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const reasons = new Map<string, string>();
  for (const skip of latest?.skipped ?? []) reasons.set(skip.guestId, skip.reason);
  return reasons;
}
