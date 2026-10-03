/**
 * Per-guest attempt limits. The campaign cap stays the default. An override
 * lets one guest be dialed again, and clearing it returns them to that default.
 */
import { expect } from 'chai';
import { parseGuestRetryCap } from '../src/api/validate.ts';
import { checkGuardrails } from '../src/runner/guardrails.ts';
import { withGuestRetryCap } from '../src/runner/retry-cap.ts';
import type { CampaignRecord, EventRecord, GuestRecord } from '../src/storage/types.ts';

const event: EventRecord = {
  id: 'launch-party-1234abcd',
  name: 'Launch party',
  startsAt: '2026-10-20T12:30:00.000Z',
  endsAt: '2026-10-20T16:30:00.000Z',
  timezone: 'Asia/Kolkata',
  brief: { about: '', where: '', notes: '' },
  sourceUrl: null,
  lastImport: null,
  createdAt: '2026-09-27T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
};

const guest: GuestRecord = {
  id: 'asha',
  sourceId: 'asha',
  name: 'Asha Rao',
  email: null,
  phone: '+919876543210',
  approvalStatus: 'approved',
  ticketName: null,
  checkedInAt: null,
  registeredAt: null,
  attributes: {},
};

function campaign(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: 'pre-event-1234abcd',
    eventId: event.id,
    type: 'pre-event',
    name: 'Pre-event reminder',
    prompt: '',
    useMasterPrompt: true,
    language: 'en',
    fields: [],
    callingWindow: { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
    retryCap: 1,
    voiceBackendOrder: ['elevenlabs'],
    queue: ['asha', 'vikram'],
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    ...overrides,
  };
}

/** 16:00 IST, inside the window and before the event. */
const INSIDE = new Date('2026-10-05T10:30:00.000Z');

describe('guest retry cap', () => {
  it('allows another dial when this guest has a higher cap than the campaign', () => {
    const guard = checkGuardrails(guest, {
      event,
      campaign: campaign({ retryCapOverrides: withGuestRetryCap(undefined, 'asha', 2) }),
      attemptsByGuest: { asha: 1 },
      now: INSIDE,
    });
    expect(guard).to.deep.equal({ ok: true });
  });

  it('follows the campaign cap again after the override is cleared', () => {
    const raised = withGuestRetryCap(undefined, 'asha', 2);
    expect(withGuestRetryCap(raised, 'asha', null)).to.equal(undefined);
    const guard = checkGuardrails(guest, {
      event,
      campaign: campaign(),
      attemptsByGuest: { asha: 1 },
      now: INSIDE,
    });
    expect(guard).to.deep.equal({ ok: false, reason: 'retry cap reached (1/1)' });
  });

  it('leaves other guests on the campaign cap and rejects a limit outside 1 to 5', () => {
    const other = checkGuardrails(
      { ...guest, id: 'vikram', phone: '+919876543211' },
      {
        event,
        campaign: campaign({ retryCapOverrides: withGuestRetryCap(undefined, 'asha', 3) }),
        attemptsByGuest: { vikram: 1 },
        now: INSIDE,
      },
    );
    expect(other).to.deep.equal({ ok: false, reason: 'retry cap reached (1/1)' });
    expect(() => parseGuestRetryCap({ retryCap: 0 })).to.throw(/between 1 and 5/);
    expect(() => parseGuestRetryCap({ retryCap: 6 })).to.throw(/between 1 and 5/);
    expect(parseGuestRetryCap({ retryCap: null })).to.equal(null);
  });
});
