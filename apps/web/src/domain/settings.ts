/**
 * Org-wide settings shapes and the catalog of context fields an admin can
 * allow or withhold from the voice backend. Mirrors the server module; product
 * copy (labels) lives here because only the UI shows them.
 */
import type { CallingWindow, CampaignType } from './types';

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

/** Developer switch from STRICT_CALLING_HOURS. Soft allows a confirmed override. */
export type CallingHoursMode = 'strict' | 'soft';

export type VoiceProviderId = 'elevenlabs' | 'fake';
export type TelephonyProviderId = 'plivo' | 'fake';

/** Which model reads a finished transcript. The API key stays on the server. */
export interface ExtractionChoice {
  provider: string;
  model: string;
}

/**
 * Providers the settings form offers. Ids stay in step with
 * EXTRACTION_PROVIDER_IDS on the server. A saved custom slug is still shown.
 */
export const EXTRACTION_PROVIDERS: {
  id: string;
  label: string;
  suggestedModel: string;
  keyVariable: string;
}[] = [
  { id: 'openrouter', label: 'OpenRouter', suggestedModel: 'openrouter/free', keyVariable: 'OPENROUTER_API_KEY' },
  { id: 'openai', label: 'OpenAI', suggestedModel: 'gpt-4o-mini', keyVariable: 'OPENAI_API_KEY' },
  { id: 'anthropic', label: 'Anthropic', suggestedModel: 'claude-3-5-haiku-latest', keyVariable: 'ANTHROPIC_API_KEY' },
  { id: 'google', label: 'Google', suggestedModel: 'gemini-2.0-flash', keyVariable: 'GOOGLE_API_KEY' },
  { id: 'ollama', label: 'Ollama', suggestedModel: 'llama3.2', keyVariable: '' },
];

export const VOICE_PROVIDERS: { id: VoiceProviderId; label: string }[] = [
  { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'fake', label: 'Fake (no real conversation)' },
];

export const TELEPHONY_PROVIDERS: { id: TelephonyProviderId; label: string }[] = [
  { id: 'plivo', label: 'Plivo' },
  { id: 'fake', label: 'Fake (does not dial)' },
];

/**
 * Whether each provider already has credentials. Booleans only. The server
 * never sends the key itself.
 */
export interface ProviderAvailability {
  extraction: Record<string, boolean>;
  voice: Record<VoiceProviderId, boolean>;
  telephony: Record<TelephonyProviderId, boolean>;
}

/** Custom hangup instructions. Matches the server limit. */
export const HANGUP_DESCRIPTION_MAX = 4000;
/** Used when the instruction field is blank. Matches the server constant. */
export const DEFAULT_HANGUP_DESCRIPTION = 'Hang up after you say goodbye.';

/**
 * The ElevenLabs agent's End call tool, as last read. `available` is false when
 * this server cannot read the agent. The API key is never included.
 */
export interface VoiceHangupStatus {
  available: boolean;
  enabled: boolean;
  description: string;
  agentId: string | null;
  error: string | null;
}

export interface OrgSettings {
  masterPrompts: Record<CampaignType, string>;
  contextFields: ContextFieldId[];
  /** Fixed number one-click pipeline tests dial. Null until set. */
  testNumber: string | null;
  /**
   * Default calling hours for new campaigns. Dialing uses each campaign's own
   * copy; change a campaign to override this org default for that queue only.
   */
  callingWindow: CallingWindow;
  /** Default attempts per guest for new campaigns. */
  retryCap: number;
  /** Quiet-guest hangup for every live call. Campaigns cannot override this. */
  silenceSeconds: number;
  /** Maximum length of one live call. Campaigns cannot override this. */
  maxCallSeconds: number;
  /** Ring timeout before a dial is abandoned. Campaigns cannot override this. */
  dialTimeoutSeconds: number;
  /** Model that reads the transcript after an answered call. */
  extraction: ExtractionChoice;
  /** Voice backend for the next answered call. */
  voiceProvider: VoiceProviderId;
  /** Carrier for the next dial. */
  telephonyProvider: TelephonyProviderId;
  updatedAt: string;
}

/** Labels and short reasons for each gate, shown on the settings page. */
export const CONTEXT_FIELD_META: Record<
  ContextFieldId,
  { label: string; hint: string }
> = {
  'event.name': { label: 'Event name', hint: 'Placeholder {{event.name}} and call context.' },
  'event.startsAt': {
    label: 'Event start time',
    hint: 'Placeholder {{event.startsAt}} and call context.',
  },
  'event.endsAt': {
    label: 'Event end time',
    hint: 'Placeholder {{event.endsAt}} and call context.',
  },
  'guest.name': { label: 'Guest full name', hint: 'Placeholder {{guest.name}} and call context.' },
  'guest.firstName': {
    label: 'Guest first name',
    hint: 'Placeholder {{guest.firstName}}.',
  },
  'guest.ticketName': {
    label: 'Ticket type',
    hint: 'Placeholder {{guest.ticketName}} and call context.',
  },
  'guest.email': { label: 'Guest email', hint: 'Appended to call context only when allowed.' },
  'guest.approvalStatus': {
    label: 'Approval status',
    hint: 'Going / Pending / etc. Appended to call context when allowed.',
  },
  'guest.phone': {
    label: 'Guest phone number',
    hint: 'Off by default. Telephony already has the number; leaving this on can leak it into the transcript.',
  },
  'guest.attributes': {
    label: 'Custom CSV answers',
    hint: 'All unknown columns from the Luma import (dietary needs, etc.).',
  },
  'campaign.language': {
    label: 'Conversation language',
    hint: 'Tells the agent which language to speak.',
  },
  'capture.fields': {
    label: 'Fields to capture',
    hint: 'The structured questions the agent must try to answer before hanging up.',
  },
};

/** Compare two calling windows field by field. */
export function sameCallingWindow(a: CallingWindow, b: CallingWindow): boolean {
  return a.start === b.start && a.end === b.end && a.timezone === b.timezone;
}
