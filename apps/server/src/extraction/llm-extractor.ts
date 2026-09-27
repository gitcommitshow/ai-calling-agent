/**
 * Extractor backed by resilient-llm, which gives us retries, rate limiting, and
 * one API across providers. The provider and model come from configuration, so
 * switching from a free OpenRouter model to a paid one is an env change.
 */
import { ResilientLLM } from 'resilient-llm';
import type { ExtractionConfig } from '../config.ts';
import type { CaptureField, TranscriptTurn } from '../storage/types.ts';
import {
  allUnknown,
  coerceValue,
  UNKNOWN,
  type ExtractionPort,
  type ExtractionRequest,
} from './types.ts';

const SYSTEM_PROMPT = [
  'You read a phone call transcript and fill in a fixed set of fields.',
  'Answer only from what the guest actually said.',
  `Use "${UNKNOWN}" whenever an answer is missing, ambiguous, or you would have to guess.`,
  'Reply with a single JSON object and nothing else: no prose, no code fences.',
].join(' ');

function describeField(field: CaptureField): string {
  if (field.kind === 'enum') {
    return `- "${field.key}": ${field.label}. One of: ${(field.options ?? []).join(', ')}, or ${UNKNOWN}.`;
  }
  if (field.kind === 'boolean') {
    return `- "${field.key}": ${field.label}. One of: yes, no, or ${UNKNOWN}.`;
  }
  return `- "${field.key}": ${field.label}. A short quote or summary, or ${UNKNOWN}.`;
}

function renderTranscript(transcript: TranscriptTurn[]): string {
  return transcript.map((turn) => `${turn.role}: ${turn.text}`).join('\n');
}

/** Tolerate a model that wrapped its JSON in prose or a code fence. */
function parseJsonObject(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? content).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('model reply contained no JSON object');

  const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('model reply was not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export class LlmExtractor implements ExtractionPort {
  readonly provider: string;
  private readonly llm: ResilientLLM;

  constructor(config: ExtractionConfig) {
    this.provider = `${config.provider}:${config.model}`;
    this.llm = new ResilientLLM({
      aiService: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      temperature: 0,
    });
  }

  async extract({ fields, transcript, language }: ExtractionRequest) {
    if (fields.length === 0) return {};
    if (transcript.length === 0) return allUnknown(fields);

    const userPrompt = [
      `The call was conducted in ${language === 'hi' ? 'Hindi' : 'English'}.`,
      'Fields to fill, with the values each one allows:',
      fields.map(describeField).join('\n'),
      'Transcript:',
      renderTranscript(transcript),
      'Reply with the JSON object now.',
    ].join('\n\n');

    const { content } = await this.llm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    const parsed = parseJsonObject(content);
    return Object.fromEntries(
      fields.map((field) => [field.key, coerceValue(field, parsed[field.key])]),
    );
  }
}
