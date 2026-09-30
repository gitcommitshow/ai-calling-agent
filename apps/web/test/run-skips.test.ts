/**
 * Unit tests for surfacing runner skip reasons. No live third-party services.
 */
import { expect } from 'chai';
import { latestSkipByGuest, summarizeSkips } from '../src/domain/run-skips';
import type { Run } from '../src/domain/types';

const windowReason = 'outside the calling window (10:00-20:00 Asia/Kolkata)';

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    eventId: 'event-1',
    campaignId: 'campaign-1',
    kind: 'queue',
    status: 'completed',
    guestIds: ['asha'],
    currentGuestId: null,
    currentAttemptId: null,
    attemptIds: [],
    skipped: [{ guestId: 'asha', reason: windowReason }],
    waiveRetryCap: false,
    waiveCallingWindow: false,
    scheduledFor: null,
    startedAt: '2026-09-29T15:07:00.000Z',
    endedAt: '2026-09-29T15:07:01.000Z',
    error: null,
    ...overrides,
  };
}

describe('summarizeSkips', () => {
  it('names a single outside-window skip', () => {
    expect(summarizeSkips([{ reason: windowReason }])).to.deep.equal([`Skipped: ${windowReason}`]);
  });

  it('groups guests that share a reason and keeps different reasons apart', () => {
    expect(
      summarizeSkips([
        { reason: windowReason },
        { reason: windowReason },
        { reason: 'retry cap reached (1/1)' },
      ]),
    ).to.deep.equal([`Skipped 2: ${windowReason}`, 'Skipped: retry cap reached (1/1)']);
  });

  it('reads the newest run for the campaign and ignores an older one', () => {
    const reasons = latestSkipByGuest(
      [
        run({
          id: 'run-0',
          startedAt: '2026-09-29T10:00:00.000Z',
          skipped: [{ guestId: 'asha', reason: 'retry cap reached (1/1)' }],
        }),
        run({ startedAt: '2026-09-29T15:07:00.000Z' }),
      ],
      'campaign-1',
    );
    expect(reasons.get('asha')).to.equal(windowReason);
  });
});
