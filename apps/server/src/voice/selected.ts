/**
 * Voice backend that follows the org settings choice. The next answered call
 * uses whichever backend is selected when it starts.
 */
import type { ProviderSelection, VoiceProviderId } from '../storage/settings.ts';
import type { VoiceBackend } from '../storage/types.ts';
import type { VoiceBackendPort, VoiceSession, VoiceSessionContext } from './types.ts';

export class SelectedVoice implements VoiceBackendPort {
  constructor(
    private readonly selection: ProviderSelection,
    private readonly adapters: Record<VoiceProviderId, VoiceBackendPort>,
  ) {}

  get backend(): VoiceBackend {
    return this.current().backend;
  }

  hasCredits(): Promise<boolean> {
    return this.current().hasCredits();
  }

  start(ctx: VoiceSessionContext): Promise<VoiceSession> {
    return this.current().start(ctx);
  }

  private current(): VoiceBackendPort {
    return this.adapters[this.selection.voiceProvider];
  }
}
