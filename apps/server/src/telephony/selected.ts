/**
 * Telephony port that follows the org settings choice. A dial uses whichever
 * carrier is selected at that moment. Hangup stays on the carrier that placed
 * the call, so changing the setting mid-call does not strand it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ProviderSelection, TelephonyProviderId } from '../storage/settings.ts';
import type { DialRequest, TelephonyEvent, TelephonyPort } from './types.ts';

export class SelectedTelephony implements TelephonyPort {
  private listener: ((event: TelephonyEvent) => void) | null = null;
  /** attemptId of a call still owned by the adapter that dialed it. */
  private readonly owners = new Map<string, TelephonyPort>();

  constructor(
    private readonly selection: ProviderSelection,
    private readonly adapters: Record<TelephonyProviderId, TelephonyPort>,
  ) {
    for (const adapter of Object.values(adapters)) {
      adapter.onEvent((event) => this.listener?.(event));
    }
  }

  get provider(): string {
    return this.current().provider;
  }

  onEvent(listener: (event: TelephonyEvent) => void): void {
    this.listener = listener;
  }

  async dial(request: DialRequest): Promise<{ providerCallId: string }> {
    const adapter = this.current();
    this.owners.set(request.attemptId, adapter);
    try {
      return await adapter.dial(request);
    } catch (error) {
      this.owners.delete(request.attemptId);
      throw error;
    }
  }

  async hangup(attemptId: string): Promise<void> {
    const adapter = this.owners.get(attemptId) ?? this.current();
    this.owners.delete(attemptId);
    await adapter.hangup(attemptId);
  }

  /** Offer the request to every carrier. Only Plivo claims its callback paths. */
  handleRequest(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
    return Object.values(this.adapters).some((adapter) => adapter.handleRequest(req, res, url));
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean {
    return Object.values(this.adapters).some((adapter) => adapter.handleUpgrade(req, socket, head, url));
  }

  async close(): Promise<void> {
    await Promise.all(Object.values(this.adapters).map((adapter) => adapter.close()));
  }

  private current(): TelephonyPort {
    return this.adapters[this.selection.telephonyProvider];
  }
}
