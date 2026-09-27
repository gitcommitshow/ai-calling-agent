/**
 * Provider-neutral contract over the phone network. Everything above this file
 * speaks in these terms only, so a second carrier is a new adapter and not a
 * change to the runner (DESIGN D6).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

/** Why a call is over, in neutral words the runner maps to an outcome. */
export type CallEndReason = 'completed' | 'busy' | 'no_answer' | 'rejected' | 'failed';

/**
 * Two-way audio for one answered call. Frames are 8 kHz mu-law, the telephony
 * standard, which the voice backends accept without resampling.
 */
export interface AudioChannel {
  /** Guest audio, frame by frame, for as long as the call is up. */
  onAudio(listener: (frame: Buffer) => void): void;
  /** Queue agent audio for playback to the guest. */
  send(frame: Buffer): void;
  /** Drop anything still queued, so the agent stops talking over the guest. */
  clear(): void;
}

export type TelephonyEvent =
  | { attemptId: string; kind: 'ringing' }
  | { attemptId: string; kind: 'answered'; channel: AudioChannel }
  | { attemptId: string; kind: 'machine_detected' }
  | { attemptId: string; kind: 'ended'; reason: CallEndReason; detail?: string };

export interface DialRequest {
  /** Our opaque correlation token. The provider hands it back on every callback. */
  attemptId: string;
  /** E.164 number, always loaded from storage by guest id. */
  to: string;
}

export interface TelephonyPort {
  readonly provider: string;
  /** Place an outbound call. Resolves once the provider accepted the request. */
  dial(request: DialRequest): Promise<{ providerCallId: string }>;
  /** End a live call. Safe to call for a call that already ended. */
  hangup(attemptId: string): Promise<void>;
  /** Neutral lifecycle notifications for every call this adapter placed. */
  onEvent(listener: (event: TelephonyEvent) => void): void;
  /**
   * Handle a provider callback or audio-socket upgrade. Returns false when the
   * request is not ours, so the JSON API can try its own route table.
   */
  handleRequest(req: IncomingMessage, res: ServerResponse, url: URL): boolean;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean;
  /** Release sockets and timers. Used on shutdown and between tests. */
  close(): Promise<void>;
}
