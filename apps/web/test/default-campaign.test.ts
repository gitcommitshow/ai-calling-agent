/**
 * Unit tests for the event page's default campaign. No live third-party services.
 */
import { expect } from 'chai';
import { defaultCampaign } from '../src/domain/default-campaign';
import type { Campaign, CampaignType } from '../src/domain/types';

const startsAt = '2026-10-10T12:30:00.000Z';

function campaign(type: CampaignType): Campaign {
  return {
    id: `${type}-1234abcd`,
    eventId: 'launch-party-1234abcd',
    type,
    name: type === 'pre-event' ? 'Pre-event reminder' : 'Post-event follow-up',
    prompt: '',
    useMasterPrompt: true,
    language: 'en',
    fields: [],
    callingWindow: { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
    retryCap: 1,
    voiceBackendOrder: ['elevenlabs'],
    queue: type === 'pre-event' ? ['asha'] : ['kabir'],
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
  };
}

// Stored order is post-event first, which used to win regardless of the date.
const campaigns = [campaign('post-event'), campaign('pre-event')];

describe('defaultCampaign', () => {
  it('opens a future event on the pre-event reminder', () => {
    const chosen = defaultCampaign(campaigns, { startsAt }, new Date('2026-10-01T10:00:00.000Z'));
    expect(chosen?.type).to.equal('pre-event');
    expect(chosen?.queue).to.deep.equal(['asha']);
  });

  it('opens a past event on the post-event feedback campaign', () => {
    const chosen = defaultCampaign(campaigns, { startsAt }, new Date('2026-10-11T10:00:00.000Z'));
    expect(chosen?.type).to.equal('post-event');
  });

  it('treats the start instant as past and falls back when that type is missing', () => {
    const atStart = defaultCampaign(campaigns, { startsAt }, new Date(startsAt));
    expect(atStart?.type).to.equal('post-event');

    const onlyReminder = [campaign('pre-event')];
    const fallback = defaultCampaign(onlyReminder, { startsAt }, new Date('2026-10-11T10:00:00.000Z'));
    expect(fallback?.id).to.equal('pre-event-1234abcd');
  });
});
