/**
 * Org-wide settings: agent personality, master prompts, context allowlist, dialing defaults, and
 * which models and providers a call uses. Runtime call limits and the provider
 * choice apply to every live call. Stored once for the deployment, not per
 * event. Provider credentials are never stored here.
 */
import type { CallingWindow, CampaignType } from './types.ts';

/**
 * Providers the settings page offers for transcript extraction. A saved custom
 * slug is still accepted, so a provider registered with resilient-llm is not
 * rejected just because it is missing from this list.
 */
export const EXTRACTION_PROVIDER_IDS = [
  'openrouter',
  'openai',
  'anthropic',
  'google',
  'ollama',
] as const;

export type ExtractionProviderId = (typeof EXTRACTION_PROVIDER_IDS)[number];

/** resilient-llm provider slug: a short lowercase name, not a URL or a key. */
export const EXTRACTION_PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,40}$/;

/** Model id the provider expects, such as openrouter/free or gpt-4o-mini. */
export const EXTRACTION_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,120}$/;

export const VOICE_PROVIDER_IDS = ['elevenlabs', 'fake'] as const;
export type VoiceProviderId = (typeof VOICE_PROVIDER_IDS)[number];

export const TELEPHONY_PROVIDER_IDS = ['plivo', 'fake'] as const;
export type TelephonyProviderId = (typeof TELEPHONY_PROVIDER_IDS)[number];

/** Which model reads a finished transcript. The API key stays in the environment. */
export interface ExtractionChoice {
  provider: string;
  model: string;
}

/**
 * The in-memory copy adapters read on each dial. Org settings are the source
 * of truth; this object is updated whenever those settings are saved.
 */
export interface ProviderSelection {
  telephonyProvider: TelephonyProviderId;
  voiceProvider: VoiceProviderId;
  extraction: ExtractionChoice;
}

/** Values used when a settings file never saved that field. Usually the environment. */
export interface SettingsSeeds {
  extraction?: ExtractionChoice;
  voiceProvider?: VoiceProviderId;
  telephonyProvider?: TelephonyProviderId;
}

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

/** How the agent talks. Longer than a sentence, shorter than a campaign prompt. */
export const AGENT_PERSONALITY_MAX = 4000;

/**
 * Style only. No event, guest, or call purpose. Prompt assembly appends this
 * on every call; the master prompts still say what that call is for.
 */
export const DEFAULT_AGENT_PERSONALITY = `Speak in short, plain sentences. Stay calm and matter-of-fact. No excitement, praise, or filler.
One or two sentences, then wait.
Give a detail only when they ask, and answer only what they asked.`;

export interface OrgSettings {
  /**
   * How the agent talks on every call. Tone and length only. Event facts stay
   * in the master prompts and the event brief. Blank adds nothing.
   */
  agentPersonality: string;
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
  /**
   * How long a silent guest has, from answer, before the agent starts talking.
   * Applies to every live call; campaigns cannot override it.
   */
  openingWaitSeconds: number;
  /**
   * How long a guest who never speaks may stay on the line before hangup.
   * Applies to every live call; campaigns cannot override it.
   */
  noResponseSeconds: number;
  /** Model that reads the transcript after an answered call. */
  extraction: ExtractionChoice;
  /** Voice backend for the next answered call. */
  voiceProvider: VoiceProviderId;
  /** Carrier for the next dial. */
  telephonyProvider: TelephonyProviderId;
  updatedAt: string;
}

/** Defaults: current template wording, and every non-phone field allowed. */
export function defaultOrgSettings(now = new Date().toISOString()): OrgSettings {
  return {
    agentPersonality: DEFAULT_AGENT_PERSONALITY,
    masterPrompts: {
      'pre-event': `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}.

Say who you are, that it starts on {{event.startsAt}}, and where it is. Then ask once whether they plan to attend.
If they ask a question, answer only that, from the event brief.`,
      'post-event': `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}, which ended on {{event.endsAt}}.

Confirm whether they made it, and ask for one piece of feedback.
If they ask about the event, answer only that, from the event brief.`,
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
    openingWaitSeconds: 3,
    noResponseSeconds: 15,
    extraction: { provider: 'openrouter', model: 'openrouter/free' },
    voiceProvider: 'elevenlabs',
    telephonyProvider: 'plivo',
    updatedAt: now,
  };
}

/** Copy a saved settings choice onto the selection the live adapters read. */
export function adoptProviderSelection(target: ProviderSelection, settings: OrgSettings): void {
  target.telephonyProvider = settings.telephonyProvider;
  target.voiceProvider = settings.voiceProvider;
  target.extraction = {
    provider: settings.extraction.provider,
    model: settings.extraction.model,
  };
}

/** Keep a stored extraction choice, or the seed when the file has none or a bad one. */
export function normalizeExtraction(value: unknown, fallback: ExtractionChoice): ExtractionChoice {
  if (!value || typeof value !== 'object') return { ...fallback };
  const record = value as { provider?: unknown; model?: unknown };
  const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  if (!EXTRACTION_PROVIDER_PATTERN.test(provider) || !EXTRACTION_MODEL_PATTERN.test(model)) {
    return { ...fallback };
  }
  return { provider, model };
}

/**
 * Keep a stored personality, including a blank one. A missing or non-string
 * value falls back to the seed so an older settings file still has a style.
 */
export function normalizeAgentPersonality(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, AGENT_PERSONALITY_MAX);
}

/** Keep a stored voice provider, or the seed when the file has none. */
export function normalizeVoiceProvider(value: unknown, fallback: VoiceProviderId): VoiceProviderId {
  return value === 'elevenlabs' || value === 'fake' ? value : fallback;
}

/** Keep a stored telephony provider, or the seed when the file has none. */
export function normalizeTelephonyProvider(
  value: unknown,
  fallback: TelephonyProviderId,
): TelephonyProviderId {
  return value === 'plivo' || value === 'fake' ? value : fallback;
}

export function isContextFieldId(value: string): value is ContextFieldId {
  return (CONTEXT_FIELD_IDS as readonly string[]).includes(value);
}
