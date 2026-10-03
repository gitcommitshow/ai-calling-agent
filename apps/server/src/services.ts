/**
 * Builds the adapters the runner needs from configuration, so the entry point
 * and the API never name a provider. The live choice is the org settings
 * selection, which starts from the environment and changes when settings are
 * saved (DESIGN D6).
 */
import { extractionKeyFor, type ServerConfig } from './config.ts';
import { SettingsExtractor } from './extraction/settings-extractor.ts';
import type { ExtractionPort } from './extraction/types.ts';
import { CallRunner } from './runner/runner.ts';
import type { ProviderSelection } from './storage/settings.ts';
import type { Storage } from './storage/types.ts';
import { FakeTelephony } from './telephony/fake.ts';
import { PlivoTelephony } from './telephony/plivo.ts';
import { SelectedTelephony } from './telephony/selected.ts';
import type { TelephonyPort } from './telephony/types.ts';
import { ElevenLabsBackend } from './voice/elevenlabs.ts';
import { FakeVoiceBackend } from './voice/fake.ts';
import { SelectedVoice } from './voice/selected.ts';
import type { VoiceBackendPort } from './voice/types.ts';

export interface CallServices {
  telephony: TelephonyPort;
  voice: VoiceBackendPort;
  extraction: ExtractionPort;
  runner: CallRunner;
  /** Mutated when settings are saved, and read by the adapters on the next call. */
  selection: ProviderSelection;
}

export function buildCallServices(
  config: ServerConfig,
  storage: Storage,
  env: NodeJS.ProcessEnv = process.env,
): CallServices {
  const selection: ProviderSelection = {
    telephonyProvider: config.telephony.provider,
    voiceProvider: config.voice.provider,
    extraction: {
      provider: config.extraction.provider,
      model: config.extraction.model,
    },
  };

  const telephony = new SelectedTelephony(selection, {
    fake: new FakeTelephony(),
    plivo: new PlivoTelephony(config.telephony, config.publicBaseUrl),
  });
  const voice = new SelectedVoice(selection, {
    fake: new FakeVoiceBackend(),
    elevenlabs: new ElevenLabsBackend(config.voice),
  });
  const extraction = new SettingsExtractor(selection, (provider) => {
    const key = extractionKeyFor(env, provider);
    if (key) return key;
    return provider === config.extraction.provider ? config.extraction.apiKey : '';
  });
  const runner = new CallRunner({
    storage,
    telephony,
    voice,
    extraction,
    limits: config.limits,
    strictCallingHours: config.strictCallingHours,
  });

  return { telephony, voice, extraction, runner, selection };
}
