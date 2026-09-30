/**
 * Server configuration read from the environment. Provider credentials never
 * leave this process and are never written to data files.
 */
import { isAbsolute, resolve } from 'node:path';

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
      apiKey: firstKey(env, [
        'EXTRACTION_API_KEY',
        ...(EXTRACTION_KEY_NAMES[extractionProvider] ?? []),
      ]),
    },
    limits: {
      maxCallSeconds: positiveInt(env.MAX_CALL_SECONDS, 240),
      silenceSeconds: positiveInt(env.SILENCE_SECONDS, 20),
      dialTimeoutSeconds: positiveInt(env.DIAL_TIMEOUT_SECONDS, 45),
    },
    strictCallingHours: boolean(env.STRICT_CALLING_HOURS, false),
  };
}

/**
 * What is still missing before a real call can be placed. Returned as a list so
 * the server can boot (and the organizer can keep editing campaigns) while
 * telling them exactly which variable to set before starting a run.
 */
export function missingCallConfig(config: ServerConfig): string[] {
  const missing: string[] = [];

  if (config.telephony.provider === 'plivo') {
    if (!config.telephony.authId) missing.push('PLIVO_AUTH_ID');
    if (!config.telephony.authToken) missing.push('PLIVO_AUTH_TOKEN');
    if (!config.telephony.callerId) missing.push('PLIVO_CALLER_ID');
    if (!/^https:\/\//.test(config.publicBaseUrl)) {
      missing.push('PUBLIC_BASE_URL (must be an https origin Plivo can reach)');
    }
  }
  if (config.voice.provider === 'elevenlabs') {
    if (!config.voice.apiKey) missing.push('ELEVENLABS_API_KEY');
    if (!config.voice.agentId) missing.push('ELEVENLABS_AGENT_ID');
  }
  if (!config.extraction.apiKey) {
    missing.push(`EXTRACTION_API_KEY (or the ${config.extraction.provider} key)`);
  }

  return missing;
}
