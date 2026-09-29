/**
 * Telephony adapter that dials nothing. Selected with TELEPHONY_PROVIDER=fake so
 * the whole run loop can be exercised locally without a carrier. It answers
 * immediately, carries no guest audio, and ends as soon as it is hung up.
 */
import type { AudioChannel, TelephonyEvent, TelephonyPort } from './types.ts';

export class FakeTelephony implements TelephonyPort {
  readonly provider = 'fake';

  private readonly listeners: ((event: TelephonyEvent) => void)[] = [];
  private readonly live = new Set<string>();
  private counter = 0;

  onEvent(listener: (event: TelephonyEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: TelephonyEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async dial({ attemptId }: { attemptId: string }): Promise<{ providerCallId: string }> {
    this.live.add(attemptId);
    const providerCallId = `fake-call-${++this.counter}`;

    setTimeout(() => {
      if (!this.live.has(attemptId)) return;
      this.emit({ attemptId, kind: 'ringing' });
      this.emit({ attemptId, kind: 'answered', channel: silentChannel() });
    }, 10);

    return { providerCallId };
  }

  async hangup(attemptId: string): Promise<void> {
    if (!this.live.delete(attemptId)) return;
    this.emit({ attemptId, kind: 'ended', reason: 'completed', detail: 'fake telephony hangup' });
  }

  /** Nothing to answer: this adapter has no callbacks and no audio socket. */
  handleRequest(): boolean {
    return false;
  }

  handleUpgrade(): boolean {
    return false;
  }

  async close(): Promise<void> {
    this.live.clear();
  }
}

function silentChannel(): AudioChannel {
  return { onAudio: () => {}, send: () => {}, clear: () => {} };
}
