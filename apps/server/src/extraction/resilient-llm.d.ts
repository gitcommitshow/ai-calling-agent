/**
 * The slice of resilient-llm (MIT) this server uses. Declared locally so the
 * only surface we depend on is the one documented in its README: construct with
 * a provider plus model, then call chat() and read the content envelope.
 */
declare module 'resilient-llm' {
  export interface ResilientLLMOptions {
    aiService?: string;
    model?: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
  }

  export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }

  export interface ChatResult {
    content: string;
    metadata?: unknown;
  }

  export class ResilientLLM {
    constructor(options?: ResilientLLMOptions);
    chat(messages: ChatMessage[], options?: ResilientLLMOptions): Promise<ChatResult>;
    abort(): void;
  }
}
