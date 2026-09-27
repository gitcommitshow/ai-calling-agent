/**
 * Voice backend contract. A backend receives the built prompt, the campaign
 * language, and the live audio channel, runs the conversation, and reports
 * transcript turns. Our server always holds the audio, which is what makes the
 * backends swappable and comparable (DESIGN D1).
 */
import type { AudioChannel } from '../telephony/types.ts';
import type { Language, TranscriptTurn, VoiceBackend } from '../storage/types.ts';

export interface VoiceSessionContext {
  attemptId: string;
  prompt: string;
  language: Language;
  /** Two-way audio for the answered call, already bridged to the guest. */
  channel: AudioChannel;
  onTranscript(turn: TranscriptTurn): void;
  /** A backend failure mid-conversation. The runner ends the attempt failed. */
  onError(error: Error): void;
}

export interface VoiceSession {
  readonly sessionId: string | null;
  /** Stop the conversation and release the provider socket. */
  close(): Promise<void>;
}

export interface VoiceBackendPort {
  readonly backend: VoiceBackend;
  /**
   * Whether the provider still has credits. Phase 2 only records the answer;
   * acting on it is phase 3's fallback work (DESIGN D2).
   */
  hasCredits(): Promise<boolean>;
  start(ctx: VoiceSessionContext): Promise<VoiceSession>;
}

/** A credit or quota refusal, kept separate so phase 3 can fall back on it. */
export class VoiceQuotaError extends Error {
  constructor(
    readonly backend: VoiceBackend,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceQuotaError';
  }
}
