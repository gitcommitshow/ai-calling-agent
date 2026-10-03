/**
 * Unit tests for which run the campaign controls follow. No live services.
 */
import { expect } from 'chai';
import { displayedRun } from '../src/domain/displayed-run';
import type { Run } from '../src/domain/types';

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
    skipped: [],
    waiveRetryCap: false,
    waiveCallingWindow: false,
    scheduledFor: null,
    startedAt: '2026-09-29T15:07:00.000Z',
    endedAt: '2026-09-29T15:07:01.000Z',
    error: null,
    ...overrides,
  };
}

describe('displayedRun', () => {
  it('follows an open run instead of a newer finished one', () => {
    const scheduled = run({
      id: 'run-sched',
      status: 'scheduled',
      startedAt: '2026-09-29T10:00:00.000Z',
      scheduledFor: '2026-09-29T12:00:00.000Z',
      endedAt: null,
    });
    const finished = run({
      id: 'run-done',
      status: 'completed',
      startedAt: '2026-09-29T11:00:00.000Z',
    });
    expect(displayedRun([finished, scheduled], 'campaign-1')?.id).to.equal('run-sched');

    const live = run({
      id: 'run-live',
      status: 'running',
      startedAt: '2026-09-29T09:00:00.000Z',
      endedAt: null,
    });
    const laterSchedule = run({
      id: 'run-later',
      status: 'scheduled',
      startedAt: '2026-09-29T12:00:00.000Z',
      scheduledFor: '2026-09-29T13:00:00.000Z',
      endedAt: null,
    });
    expect(displayedRun([laterSchedule, live], 'campaign-1')?.id).to.equal('run-live');
  });
});
