/**
 * Unit tests for prompt assembly with master prompts and context gates.
 * No live third-party services.
 */
import { describe, it } from 'node:test';
import { expect } from 'chai';
import { assemblePrompt, effectivePrompt } from '../src/domain/prompt';
import type { OrgSettings } from '../src/domain/settings';
import type { Campaign, Event, Guest } from '../src/domain/types';

const event: Event = {
  id: 'evt-1',
  name: 'Launch party',
  startsAt: '2026-10-10T12:30:00.000Z',
  endsAt: '2026-10-10T16:30:00.000Z',
  timezone: 'Asia/Kolkata',
  brief: {
    about: 'A dinner for the design team.',
    where: 'The studio on Hill Road.',
    notes: 'Doors open at 6.',
  },
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
  ticketName: 'VIP',
  checkedInAt: null,
  registeredAt: null,
  attributes: { Dietary: 'Vegetarian' },
};

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'pre-1',
    eventId: event.id,
    type: 'pre-event',
    name: 'Pre-event',
    prompt: 'Custom: hello {{guest.name}} at {{guest.email}}.',
    useMasterPrompt: false,
    language: 'en',
    fields: [{ key: 'will_attend', label: 'Will they attend?', kind: 'boolean' }],
    callingWindow: { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
    retryCap: 1,
    voiceBackendOrder: ['elevenlabs'],
    queue: [guest.id],
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    ...overrides,
  };
}

function settings(overrides: Partial<OrgSettings> = {}): OrgSettings {
  return {
    masterPrompts: {
      'pre-event': 'Master: welcome {{guest.firstName}} to {{event.name}}.',
      'post-event': 'Master post.',
    },
    contextFields: [
      'event.name',
      'guest.name',
      'guest.firstName',
      'guest.ticketName',
      'campaign.language',
      'capture.fields',
    ],
    updatedAt: event.createdAt,
    ...overrides,
    testNumber: overrides.testNumber ?? null,
  };
}

describe('assemblePrompt', () => {
  it('uses the master prompt when the campaign opts in', () => {
    const text = effectivePrompt(campaign({ useMasterPrompt: true }), settings());
    expect(text).to.include('Master: welcome');
    expect(assemblePrompt({ event, campaign: campaign({ useMasterPrompt: true }), guest, settings: settings() }))
      .to.include('Launch party')
      .and.to.include('Asha')
      .and.to.include('The studio on Hill Road.')
      .and.to.include('Doors open at 6.')
      .and.to.include('follow these notes')
      .and.to.include('someone will call them back');
  });

  it('withholds gated-off fields from context and leaves their placeholders intact', () => {
    const text = assemblePrompt({
      event,
      campaign: campaign(),
      guest,
      settings: settings({ contextFields: ['guest.name', 'campaign.language'] }),
    });
    expect(text).to.include('Custom: hello Asha Rao at {{guest.email}}.');
    expect(text).to.include('- Guest: Asha Rao');
    expect(text).to.include('Speak in English');
    expect(text).to.not.include('VIP');
    expect(text).to.not.include('asha@example.com');
    expect(text).to.not.include('Vegetarian');
    expect(text).to.not.include('+919876543210');
    expect(text).to.not.include('Collect these answers');
  });

  it('adds the call purpose after the agent prompt and skips a blank one', () => {
    const withPurpose = assemblePrompt({
      event,
      campaign: campaign({
        useMasterPrompt: true,
        purpose: 'Ask speakers to arrive 20 minutes early.',
      }),
      guest,
      settings: settings(),
    });
    expect(withPurpose).to.include('Master: welcome Asha to Launch party.');
    expect(withPurpose).to.include(
      'The main purpose of this call: Ask speakers to arrive 20 minutes early.',
    );

    const blank = assemblePrompt({
      event,
      campaign: campaign({ useMasterPrompt: true, purpose: '   ' }),
      guest,
      settings: settings(),
    });
    expect(blank).to.not.include('The main purpose of this call');
  });

  it('includes email, attributes, and phone only when those gates are on', () => {
    const text = assemblePrompt({
      event,
      campaign: campaign(),
      guest,
      settings: settings({
        contextFields: ['guest.email', 'guest.attributes', 'guest.phone', 'capture.fields'],
      }),
    });
    expect(text).to.include('Email: asha@example.com');
    expect(text).to.include('Dietary: Vegetarian');
    expect(text).to.include('Phone: +919876543210');
    expect(text).to.include('will_attend');
  });
});
