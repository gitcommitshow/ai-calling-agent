/**
 * Unanswered questions and the follow-up that skips the retry cap.
 * No live third-party services.
 */
import { expect } from 'chai';
import { coerceOpenQuestions } from '../src/extraction/types.ts';
import { checkGuardrails } from '../src/runner/guardrails.ts';
import type { CampaignRecord, EventRecord, GuestRecord } from '../src/storage/types.ts';

const event: EventRecord = {
  id: 'launch-party-1234abcd',
  name: 'Launch party',
  startsAt: '2026-10-20T12:30:00.000Z',
  endsAt: '2026-10-20T16:30:00.000Z',
  timezone: 'Asia/Kolkata',
  brief: { about: 'A dinner.', where: '', notes: '' },
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

function campaign(): CampaignRecord {
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
    queue: ['asha'],
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/** 16:00 IST, inside the default window and before the event. */
const INSIDE = new Date('2026-10-05T10:30:00.000Z');
/** 08:00 IST, before the calling window opens. */
const OUTSIDE = new Date('2026-10-05T02:30:00.000Z');

describe('open questions', () => {
  it('keeps a clear question and drops a blank one', () => {
    expect(
      coerceOpenQuestions(['Where is the venue?', '  ', 'unknown', 'Where is the venue?']),
    ).to.deep.equal(['Where is the venue?']);
  });

  it('refuses a normal redial once the retry cap is used', () => {
    const guard = checkGuardrails(guest, {
      event,
      campaign: campaign(),
      attemptsByGuest: { asha: 1 },
      now: INSIDE,
    });
    expect(guard).to.deep.equal({ ok: false, reason: 'retry cap reached (1/1)' });
  });

  it('allows a follow-up after the retry cap and still refuses it outside the calling window', () => {
    const base = {
      event,
      campaign: campaign(),
      attemptsByGuest: { asha: 1 },
      waiveRetryCap: true,
    };
    expect(checkGuardrails(guest, { ...base, now: INSIDE })).to.deep.equal({ ok: true });
    const outside = checkGuardrails(guest, { ...base, now: OUTSIDE });
    expect(outside.ok).to.equal(false);
    if (!outside.ok) expect(outside.reason).to.include('outside the calling window');
  });
});
