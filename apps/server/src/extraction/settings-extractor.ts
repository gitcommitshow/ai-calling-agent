/**
 * Extractor that follows the org settings choice. A new client is built per
 * transcript, so a saved provider and model apply to the next call without a
 * restart. The API key is looked up here and never stored.
 */
import type { ProviderSelection } from '../storage/settings.ts';
import { LlmExtractor } from './llm-extractor.ts';
import type { ExtractionPort, ExtractionRequest, ExtractionResult } from './types.ts';

export class SettingsExtractor implements ExtractionPort {
  constructor(
    private readonly selection: ProviderSelection,
    private readonly apiKeyFor: (provider: string) => string,
  ) {}

  get provider(): string {
    const { provider, model } = this.selection.extraction;
    return `${provider}:${model}`;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const { provider, model } = this.selection.extraction;
    const apiKey = this.apiKeyFor(provider);
    if (!apiKey && provider !== 'ollama') {
      throw new Error(`no API key for extraction provider ${provider}`);
    }
    return new LlmExtractor({ provider, model, apiKey }).extract(request);
  }
}
