/**
 * Unit tests for call eligibility rules. No live third-party services.
 */
import { expect } from 'chai';
import {
  checkEligibility,
  localClockTime,
  shouldWaiveCallingWindow,
} from '../src/domain/eligibility';
import type { Campaign, Event, Guest } from '../src/domain/types';

const event: Event = {
  id: 'launch-party-1234abcd',
  name: 'Launch party',
  startsAt: '2026-10-10T12:30:00.000Z',
  endsAt: '2026-10-10T16:30:00.000Z',
  timezone: 'Asia/Kolkata',
  brief: { about: '', where: '', notes: '' },
  sourceUrl: null,
  lastImport: null,
  createdAt: '2026-09-27T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
};

const guest: Guest = {
  id: 'asha',
  sourceId: 'gst-1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  phone: '+919876543210',
  approvalStatus: 'approved',
  ticketName: 'General',
  checkedInAt: null,
  registeredAt: null,
  attributes: {},
};

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'pre-event-1234abcd',
    eventId: event.id,
    type: 'pre-event',
    name: 'Pre-event reminder',
    prompt: 'Remind {{guest.firstName}} about {{event.name}}.',
    useMasterPrompt: false,
    language: 'en',
    fields: [],
    callingWindow: { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
    retryCap: 1,
    voiceBackendOrder: ['elevenlabs'],
    queue: [guest.id],
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    ...overrides,
  };
}

// 2026-10-05 16:00 IST: before the event, inside the 10:00-20:00 window.
const insideWindow = new Date('2026-10-05T10:30:00.000Z');

describe('checkEligibility', () => {
  it('accepts a queued guest before the event and inside the window', () => {
    const result = checkEligibility(guest, {
      event,
      campaign: campaign(),
      attemptsByGuest: {},
      now: insideWindow,
    });
    expect(result).to.deep.equal({ eligible: true });
  });

  it('rejects a post-event campaign before the event ends', () => {
    const result = checkEligibility(guest, {
      event,
      campaign: campaign({ type: 'post-event' }),
      attemptsByGuest: {},
      now: insideWindow,
    });
    expect(result).to.deep.equal({ eligible: false, reason: 'the event has not ended yet' });
  });

  it('rejects a guest over the retry cap or outside the calling window', () => {
    expect(
      checkEligibility(guest, {
        event,
        campaign: campaign(),
        attemptsByGuest: { [guest.id]: 1 },
        now: insideWindow,
      }),
    ).to.deep.equal({ eligible: false, reason: 'retry cap reached (1/1)' });

    // 03:00 IST, well outside 10:00-20:00.
    const lateNight = new Date('2026-10-04T21:30:00.000Z');
    expect(
      checkEligibility(guest, {
        event,
        campaign: campaign(),
        attemptsByGuest: {},
        now: lateNight,
      }),
    ).to.deep.equal({
      eligible: false,
      reason: 'outside the calling window (10:00-20:00 Asia/Kolkata)',
    });
  });

  it('treats local midnight as inside a window that starts then', () => {
    const window = { start: '00:00', end: '20:00', timezone: 'Asia/Kolkata' };
    // 00:00 IST. Engines that report this as 24:00 used to miss the window.
    const midnight = new Date('2026-10-04T18:30:00.000Z');
    expect(localClockTime(midnight, 'Asia/Kolkata')).to.equal('00:00');
    expect(
      checkEligibility(guest, {
        event,
        campaign: campaign({ callingWindow: window }),
        attemptsByGuest: {},
        now: midnight,
      }),
    ).to.deep.equal({ eligible: true });

    const closed = new Date('2026-10-04T21:30:00.000Z');
    expect(shouldWaiveCallingWindow(midnight, window, 'soft')).to.equal(false);
    expect(shouldWaiveCallingWindow(closed, campaign().callingWindow, 'soft')).to.equal(true);
    expect(shouldWaiveCallingWindow(closed, campaign().callingWindow, 'strict')).to.equal(false);
  });
});
