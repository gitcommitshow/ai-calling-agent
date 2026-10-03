/**
 * Extractor backed by resilient-llm, which gives us retries, rate limiting, and
 * one API across providers. The provider and model come from org settings, so
 * switching from a free OpenRouter model to a paid one is a settings change.
 */
import { ResilientLLM } from 'resilient-llm';
import type { ExtractionConfig } from '../config.ts';
import type { CaptureField, EventBrief, TranscriptTurn } from '../storage/types.ts';
import {
  allUnknown,
  coerceOpenQuestions,
  coerceValue,
  UNKNOWN,
  type ExtractionPort,
  type ExtractionRequest,
  type ExtractionResult,
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

/**
 * The facts the call was allowed to say, so the model can tell a real gap from
 * an answered one. Notes are listed last and outrank the description.
 */
function renderBrief(brief: EventBrief): string {
  const lines = [
    brief.about.trim(),
    brief.where.trim() && `Where: ${brief.where.trim()}`,
  ].filter((line): line is string => Boolean(line));
  const notes = brief.notes.trim();
  const body = lines.join('\n');
  if (!notes) return body || 'The brief is empty.';
  const prefix = body ? `${body}\n\n` : '';
  return `${prefix}Latest notes. When these disagree with the description above, follow these notes:\n${notes}`;
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

  async extract({
    fields,
    transcript,
    language,
    brief,
    captureQuestions,
  }: ExtractionRequest): Promise<ExtractionResult> {
    if (transcript.length === 0) return { fields: allUnknown(fields), openQuestions: [] };
    if (fields.length === 0 && !captureQuestions) return { fields: {}, openQuestions: [] };

    const questionRule = captureQuestions
      ? `Also include "openQuestions": an array of questions the guest asked that the event brief does not answer, in the guest's words. Omit questions the brief answers, and omit anything unclear. Use [] when there are none.`
      : 'Do not include an openQuestions field.';

    const userPrompt = [
      `The call was conducted in ${language === 'hi' ? 'Hindi' : 'English'}.`,
      'Event brief:',
      renderBrief(brief),
      'Fields to fill, with the values each one allows:',
      fields.length > 0 ? fields.map(describeField).join('\n') : 'No fields.',
      questionRule,
      'Transcript:',
      renderTranscript(transcript),
      'Reply with the JSON object now.',
    ].join('\n\n');

    const { content } = await this.llm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    const parsed = parseJsonObject(content);
    return {
      fields: Object.fromEntries(
        fields.map((field) => [field.key, coerceValue(field, parsed[field.key])]),
      ),
      openQuestions: captureQuestions ? coerceOpenQuestions(parsed.openQuestions) : [],
    };
  }
}
