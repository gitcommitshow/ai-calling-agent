/**
 * Which campaign the event page opens on. The start time is the event date:
 * before it, the pre-event reminder is the useful queue; once it has passed,
 * the post-event campaign (guest feedback) is.
 */
import type { Campaign, CampaignType, Event } from './types';

/** The campaign the event detail queue should show first. */
export function defaultCampaign(
  campaigns: Campaign[],
  event: Pick<Event, 'startsAt'>,
  now: Date,
): Campaign | undefined {
  if (campaigns.length === 0) return undefined;

  const preferred: CampaignType = now < new Date(event.startsAt) ? 'pre-event' : 'post-event';
  return campaigns.find((campaign) => campaign.type === preferred) ?? campaigns[0];
}
