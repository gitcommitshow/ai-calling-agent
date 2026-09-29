/**
 * Voice backend that talks to no provider. Selected with VOICE_PROVIDER=fake so
 * the run loop, transcript persistence, and extraction can be worked on
 * offline. It emits a short scripted exchange and then falls silent.
 */
import type { TranscriptTurn, VoiceBackend } from '../storage/types.ts';
import type { VoiceBackendPort, VoiceSession, VoiceSessionContext } from './types.ts';

const SCRIPT: [TranscriptTurn['role'], string][] = [
  ['agent', 'Hello, calling with a quick question about the event.'],
  ['guest', 'Yes, I plan to attend. It sounded useful.'],
  ['agent', 'Noted, thank you. See you there.'],
];

export class FakeVoiceBackend implements VoiceBackendPort {
  readonly backend: VoiceBackend = 'elevenlabs';

  async hasCredits(): Promise<boolean> {
    return true;
  }

  async start(ctx: VoiceSessionContext): Promise<VoiceSession> {
    let stopped = false;
    for (const [role, text] of SCRIPT) {
      if (stopped) break;
      ctx.onTranscript({ role, text, at: new Date().toISOString() });
    }

    return {
      sessionId: `fake-session-${ctx.attemptId}`,
      close: async () => {
        stopped = true;
      },
    };
  }
}
