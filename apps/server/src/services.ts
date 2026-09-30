/**
 * Builds the adapters the runner needs from configuration, so the entry point
 * and the API never name a provider. Swapping a provider is a config change
 * plus one branch here (DESIGN D6).
 */
import type { ServerConfig } from './config.ts';
import { LlmExtractor } from './extraction/llm-extractor.ts';
import type { ExtractionPort } from './extraction/types.ts';
import { CallRunner } from './runner/runner.ts';
import type { Storage } from './storage/types.ts';
import { FakeTelephony } from './telephony/fake.ts';
import { PlivoTelephony } from './telephony/plivo.ts';
import type { TelephonyPort } from './telephony/types.ts';
import { ElevenLabsBackend } from './voice/elevenlabs.ts';
import { FakeVoiceBackend } from './voice/fake.ts';
import type { VoiceBackendPort } from './voice/types.ts';

export interface CallServices {
  telephony: TelephonyPort;
  voice: VoiceBackendPort;
  extraction: ExtractionPort;
  runner: CallRunner;
}

export function buildCallServices(config: ServerConfig, storage: Storage): CallServices {
  const telephony: TelephonyPort =
    config.telephony.provider === 'fake'
      ? new FakeTelephony()
      : new PlivoTelephony(config.telephony, config.publicBaseUrl);

  const voice: VoiceBackendPort =
    config.voice.provider === 'fake'
      ? new FakeVoiceBackend()
      : new ElevenLabsBackend(config.voice);

  const extraction = new LlmExtractor(config.extraction);
  const runner = new CallRunner({
    storage,
    telephony,
    voice,
    extraction,
    limits: config.limits,
    strictCallingHours: config.strictCallingHours,
  });

  return { telephony, voice, extraction, runner };
}
