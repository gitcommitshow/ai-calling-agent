/**
 * Org-wide settings: master prompts, context allowlist, and dialing defaults
 * that new campaigns inherit. Runtime call limits here apply to every live call.
 * Stored once for the deployment, not per event.
 */
import type { CallingWindow, CampaignType } from './types.ts';

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
  /**
   * Default calling hours copied onto new campaigns. Each campaign stores its
   * own window; the runner enforces the campaign copy, not this org default.
   */
  callingWindow: CallingWindow;
  /** Default retry cap copied onto new campaigns. The campaign value is dialed. */
  retryCap: number;
  /**
   * How long a quiet guest may stay on the line before hangup. Applies to every
   * live call; campaigns cannot override it.
   */
  silenceSeconds: number;
  /** Hard cap on one live call. Applies to every call; campaigns cannot override. */
  maxCallSeconds: number;
  /** How long to wait for answer before giving up. Applies to every dial. */
  dialTimeoutSeconds: number;
  updatedAt: string;
}

/** Defaults: current template wording, and every non-phone field allowed. */
export function defaultOrgSettings(now = new Date().toISOString()): OrgSettings {
  return {
    masterPrompts: {
      'pre-event': `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}.

Introduce yourself in one sentence and say it starts on {{event.startsAt}}. Share the facts from the event brief when they help.
Ask once whether they plan to attend. If they ask a question, answer it from that brief.
Keep the call under two minutes and stay polite if they want to end it.`,
      'post-event': `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}, which ended on {{event.endsAt}}.

Thank them, confirm whether they made it, and ask for one piece of feedback. If they ask about the event, answer from the event brief.
Keep the call under two minutes and stay polite if they want to end it.`,
    },
    // Phone stays off by default: it is already known to telephony and is easy
    // to leak into transcripts if the model repeats it.
    contextFields: CONTEXT_FIELD_IDS.filter((id) => id !== 'guest.phone'),
    testNumber: null,
    callingWindow: { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
    retryCap: 1,
    silenceSeconds: 20,
    maxCallSeconds: 240,
    dialTimeoutSeconds: 45,
    updatedAt: now,
  };
}

export function isContextFieldId(value: string): value is ContextFieldId {
  return (CONTEXT_FIELD_IDS as readonly string[]).includes(value);
}
