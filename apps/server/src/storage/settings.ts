/**
 * Org-wide settings: master prompts and the allowlist of call context that may
 * reach a voice backend. Stored once for the deployment, not per event.
 */
import type { CampaignType } from './types.ts';

/** Every piece of guest or event data that can appear in a call prompt. */
export const CONTEXT_FIELD_IDS = [
  'event.name',
  'event.startsAt',
  'event.endsAt',
  'guest.name',
  'guest.firstName',
  'guest.ticketName',
  'guest.email',
  'guest.approvalStatus',
  'guest.phone',
  'guest.attributes',
  'campaign.language',
  'capture.fields',
] as const;

export type ContextFieldId = (typeof CONTEXT_FIELD_IDS)[number];

export interface OrgSettings {
  /** Shared prompt body per campaign type. Campaigns may opt into a custom one. */
  masterPrompts: Record<CampaignType, string>;
  /**
   * Only these fields are substituted into placeholders or appended as call
   * context. Everything else is withheld from the voice backend.
   */
  contextFields: ContextFieldId[];
  /** Fixed number one-click pipeline tests dial. Null until the organizer sets it. */
  testNumber: string | null;
  updatedAt: string;
}

/** Defaults: current template wording, and every non-phone field allowed. */
export function defaultOrgSettings(now = new Date().toISOString()): OrgSettings {
  return {
    masterPrompts: {
      'pre-event': `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}.

Introduce yourself as an assistant calling about the event, and say it starts on {{event.startsAt}}.
Ask whether they plan to attend. If they are unsure, ask what would help them decide.
Keep the call under two minutes and stay polite if they want to end it.`,
      'post-event': `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}, which ended on {{event.endsAt}}.

Thank them for their interest, confirm whether they made it to the event, and ask for one piece of feedback.
Keep the call under two minutes and stay polite if they want to end it.`,
    },
    // Phone stays off by default: it is already known to telephony and is easy
    // to leak into transcripts if the model repeats it.
    contextFields: CONTEXT_FIELD_IDS.filter((id) => id !== 'guest.phone'),
    testNumber: null,
    updatedAt: now,
  };
}

export function isContextFieldId(value: string): value is ContextFieldId {
  return (CONTEXT_FIELD_IDS as readonly string[]).includes(value);
}
