/**
 * Which run the campaign controls should follow. A live dial wins over a
 * waiting start, and either wins over a newer finished run, so a later
 * one-guest call cannot hide a schedule that will still dial.
 */
import { LIVE_RUN_STATUSES, type Run } from './types';

/** Lower rank is the run the organizer needs to see. */
function rank(run: Run): number {
  if (LIVE_RUN_STATUSES.includes(run.status)) return 0;
  if (run.status === 'scheduled') return 1;
  return 2;
}

/**
 * Pick the run to show for one campaign. `override` is a newer copy from
 * polling and replaces the same id from `runsNewestFirst`.
 */
export function displayedRun(
  runsNewestFirst: Run[],
  campaignId: string,
  override?: Run | null,
): Run | null {
  const byId = new Map<string, Run>();
  for (const run of runsNewestFirst) {
    if (run.campaignId === campaignId) byId.set(run.id, run);
  }
  if (override && override.campaignId === campaignId) byId.set(override.id, override);

  const runs = [...byId.values()];
  if (runs.length === 0) return null;
  runs.sort((a, b) => rank(a) - rank(b) || b.startedAt.localeCompare(a.startedAt));
  return runs[0] ?? null;
}
