/**
 * Server configuration read from the environment. Provider credentials never
 * leave this process and are never written to data files.
 */
import { isAbsolute, resolve } from 'node:path';
import {
  EXTRACTION_PROVIDER_IDS,
  type ProviderSelection,
  type SettingsSeeds,
} from './storage/settings.ts';

/** Telephony vendor selection. `fake` dials nothing and is for local work only. */
export interface TelephonyConfig {
  provider: 'plivo' | 'fake';
  authId: string;
  authToken: string;
  callerId: string;
  /** Reject callbacks whose Plivo signature does not verify. Off only locally. */
  verifySignature: boolean;
}

export interface VoiceConfig {
  provider: 'elevenlabs' | 'fake';
  apiKey: string;
  agentId: string;
}

/**
 * Extraction runs through resilient-llm, so the provider is a plain string it
 * understands (openai, anthropic, google, openrouter, ollama, or a registered
 * custom provider) rather than an enum we have to keep in step.
 */
export interface ExtractionConfig {
  provider: string;
  model: string;
  apiKey: string;
}

/** Hard stops that keep one stuck conversation from running forever. */
export interface CallLimits {
  maxCallSeconds: number;
  silenceSeconds: number;
  dialTimeoutSeconds: number;
  /** Seconds a silent guest has before the agent starts the call. */
  openingWaitSeconds: number;
  /** Seconds from answer before a guest who never speaks is hung up. */
  noResponseSeconds: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  /** Public origin the telephony provider reaches our callbacks and audio on. */
  publicBaseUrl: string;
  telephony: TelephonyConfig;
  voice: VoiceConfig;
  extraction: ExtractionConfig;
  limits: CallLimits;
  /**
   * When true, a dial outside calling hours is refused even after the organizer
   * confirms the risk. Set with STRICT_CALLING_HOURS.
   */
  strictCallingHours: boolean;
}

function text(value: string | undefined, fallback = ''): string {
  return value?.trim() || fallback;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boolean(value: string | undefined, fallback: boolean): boolean {
  const raw = text(value).toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** First key that is actually set, so one provider switch needs no renaming. */
function firstKey(env: NodeJS.ProcessEnv, names: string[]): string {
  for (const name of names) {
    const value = text(env[name]);
    if (value) return value;
  }
  return '';
}

const EXTRACTION_KEY_NAMES: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  ollama: ['OLLAMA_API_KEY'],
};

/**
 * Key for one extraction provider. The provider's own variable wins, then
 * EXTRACTION_API_KEY, so a settings change can pick a provider that already
 * has a key without renaming variables.
 */
export function extractionKeyFor(env: NodeJS.ProcessEnv, provider: string): string {
  return firstKey(env, [...(EXTRACTION_KEY_NAMES[provider] ?? []), 'EXTRACTION_API_KEY']);
}

/** Whether that provider can be called with the keys this process already has. */
function extractionKeyPresent(
  config: ServerConfig,
  provider: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if (provider === 'ollama') return true;
  if (extractionKeyFor(env, provider)) return true;
  return provider === config.extraction.provider && Boolean(config.extraction.apiKey);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawDataDir = text(env.DATA_DIR, './data');
  const port = positiveInt(env.PORT, 4000);
  const host = text(env.HOST, '127.0.0.1');
  const extractionProvider = text(env.EXTRACTION_PROVIDER, 'openrouter');

  return {
    port,
    host,
    dataDir: isAbsolute(rawDataDir) ? rawDataDir : resolve(process.cwd(), rawDataDir),
    publicBaseUrl: text(env.PUBLIC_BASE_URL, `http://${host}:${port}`).replace(/\/+$/, ''),
    telephony: {
      provider: text(env.TELEPHONY_PROVIDER, 'plivo') === 'fake' ? 'fake' : 'plivo',
      authId: text(env.PLIVO_AUTH_ID),
      authToken: text(env.PLIVO_AUTH_TOKEN),
      callerId: text(env.PLIVO_CALLER_ID),
      verifySignature: boolean(env.PLIVO_VERIFY_SIGNATURE, true),
    },
    voice: {
      provider: text(env.VOICE_PROVIDER, 'elevenlabs') === 'fake' ? 'fake' : 'elevenlabs',
      apiKey: text(env.ELEVENLABS_API_KEY),
      agentId: text(env.ELEVENLABS_AGENT_ID),
    },
    extraction: {
      provider: extractionProvider,
      model: text(env.EXTRACTION_MODEL, 'openrouter/free'),
      apiKey: extractionKeyFor(env, extractionProvider),
    },
    limits: {
      maxCallSeconds: positiveInt(env.MAX_CALL_SECONDS, 240),
      silenceSeconds: positiveInt(env.SILENCE_SECONDS, 20),
      dialTimeoutSeconds: positiveInt(env.DIAL_TIMEOUT_SECONDS, 45),
      openingWaitSeconds: 3,
      noResponseSeconds: 15,
    },
    strictCallingHours: boolean(env.STRICT_CALLING_HOURS, false),
  };
}

/**
 * Seeds for a settings file that has never saved a provider. The environment
 * wins until the organizer saves a choice on the settings page.
 */
export function settingsSeedsFromConfig(config: ServerConfig): SettingsSeeds {
  return {
    extraction: {
      provider: config.extraction.provider,
      model: config.extraction.model,
    },
    voiceProvider: config.voice.provider,
    telephonyProvider: config.telephony.provider,
  };
}

/** Which configured providers already have the credentials a call needs. */
export interface ProviderAvailability {
  extraction: Record<string, boolean>;
  voice: { elevenlabs: boolean; fake: boolean };
  telephony: { plivo: boolean; fake: boolean };
}

/**
 * Key presence for the settings page. Reports booleans only, never the key.
 * `extraProviders` covers a saved custom slug that is not in the built-in list.
 */
export function describeProviderAvailability(
  config: ServerConfig,
  extraProviders: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): ProviderAvailability {
  const extraction: Record<string, boolean> = {};
  for (const id of [...EXTRACTION_PROVIDER_IDS, ...extraProviders]) {
    extraction[id] = extractionKeyPresent(config, id, env);
  }
  return {
    extraction,
    voice: {
      elevenlabs: Boolean(config.voice.apiKey && config.voice.agentId),
      fake: true,
    },
    telephony: {
      plivo: Boolean(
        config.telephony.authId &&
          config.telephony.authToken &&
          config.telephony.callerId &&
          /^https:\/\//.test(config.publicBaseUrl),
      ),
      fake: true,
    },
  };
}

/**
 * What is still missing before a real call can be placed. Returned as a list so
 * the server can boot (and the organizer can keep editing campaigns) while
 * telling them exactly which variable to set before starting a run. When a
 * selection is passed, the check follows the saved settings choice.
 */
export function missingCallConfig(
  config: ServerConfig,
  selection?: Pick<ProviderSelection, 'telephonyProvider' | 'voiceProvider' | 'extraction'>,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const telephonyProvider = selection?.telephonyProvider ?? config.telephony.provider;
  const voiceProvider = selection?.voiceProvider ?? config.voice.provider;
  const extractionProvider = selection?.extraction.provider ?? config.extraction.provider;
  const missing: string[] = [];

  if (telephonyProvider === 'plivo') {
    if (!config.telephony.authId) missing.push('PLIVO_AUTH_ID');
    if (!config.telephony.authToken) missing.push('PLIVO_AUTH_TOKEN');
    if (!config.telephony.callerId) missing.push('PLIVO_CALLER_ID');
    if (!/^https:\/\//.test(config.publicBaseUrl)) {
      missing.push('PUBLIC_BASE_URL (must be an https origin Plivo can reach)');
    }
  }
  if (voiceProvider === 'elevenlabs') {
    if (!config.voice.apiKey) missing.push('ELEVENLABS_API_KEY');
    if (!config.voice.agentId) missing.push('ELEVENLABS_AGENT_ID');
  }
  if (!extractionKeyPresent(config, extractionProvider, env)) {
    const named = EXTRACTION_KEY_NAMES[extractionProvider]?.[0];
    missing.push(
      named ? `${named} or EXTRACTION_API_KEY` : `EXTRACTION_API_KEY (or the ${extractionProvider} key)`,
    );
  }

  return missing;
}
