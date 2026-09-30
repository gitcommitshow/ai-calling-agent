/**
 * STRICT_CALLING_HOURS: soft mode allows a confirmed override, strict mode does not.
 * No live third-party services.
 */
import { expect } from 'chai';
import { loadConfig } from '../src/config.ts';
import { checkGuardrails, scheduleBlockReason } from '../src/runner/guardrails.ts';
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

const campaign: CampaignRecord = {
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

/** 16:00 IST, inside the window and before the event. */
const INSIDE = new Date('2026-10-05T10:30:00.000Z');
/** 08:00 IST, before the calling window opens. */
const OUTSIDE = new Date('2026-10-05T02:30:00.000Z');

describe('calling hours mode', () => {
  it('stays soft unless STRICT_CALLING_HOURS is set, and a confirmed override then dials', () => {
    expect(loadConfig({}).strictCallingHours).to.equal(false);
    expect(loadConfig({ STRICT_CALLING_HOURS: 'false' }).strictCallingHours).to.equal(false);

    const guard = checkGuardrails(guest, {
      event,
      campaign,
      attemptsByGuest: {},
      now: OUTSIDE,
      waiveCallingWindow: true,
    });
    expect(guard).to.deep.equal({ ok: true });
  });

  it('refuses an override when calling hours are strict', () => {
    expect(loadConfig({ STRICT_CALLING_HOURS: 'true' }).strictCallingHours).to.equal(true);
    expect(loadConfig({ STRICT_CALLING_HOURS: 'yes' }).strictCallingHours).to.equal(true);

    const guard = checkGuardrails(guest, {
      event,
      campaign,
      attemptsByGuest: {},
      now: OUTSIDE,
      waiveCallingWindow: true,
      strictCallingHours: true,
    });
    expect(guard.ok).to.equal(false);
    if (!guard.ok) expect(guard.reason).to.include('STRICT_CALLING_HOURS');

    const scheduled = scheduleBlockReason(event, campaign, OUTSIDE, {
      waiveCallingWindow: true,
      strictCallingHours: true,
    });
    expect(scheduled).to.include('STRICT_CALLING_HOURS');
  });

  it('still dials inside the window when calling hours are strict', () => {
    const guard = checkGuardrails(guest, {
      event,
      campaign,
      attemptsByGuest: {},
      now: INSIDE,
      strictCallingHours: true,
    });
    expect(guard).to.deep.equal({ ok: true });
    expect(scheduleBlockReason(event, campaign, INSIDE, { strictCallingHours: true })).to.equal(null);
  });
});
