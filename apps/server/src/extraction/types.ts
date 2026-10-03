/**
 * Extraction contract. One shared step turns a finished transcript into the
 * campaign's captured fields, so results from different voice backends stay
 * comparable (DESIGN D3).
 */
import type { CaptureField, EventBrief, Language, TranscriptTurn } from '../storage/types.ts';

export interface ExtractionRequest {
  fields: CaptureField[];
  transcript: TranscriptTurn[];
  language: Language;
  /** What the call was allowed to say, so a question the brief answers is not kept. */
  brief: EventBrief;
  /** Guest calls ask for unanswered questions. Pipeline tests do not. */
  captureQuestions: boolean;
}

/** Captured fields plus the questions the brief could not answer. */
export interface ExtractionResult {
  fields: Record<string, string>;
  openQuestions: string[];
}

export interface ExtractionPort {
  readonly provider: string;
  /**
   * One value per requested field. Anything missing, unclear, or failing
   * validation comes back as `unknown` rather than a guess. Questions are
   * the guest's words, and only when captureQuestions is set.
   */
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}

export const UNKNOWN = 'unknown';

/** Every field set to unknown. Used when there is nothing to extract from. */
export function allUnknown(fields: CaptureField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, UNKNOWN]));
}

/**
 * Coerce one model answer into a value the field definition allows. Validation
 * lives here rather than in the adapter so every provider is held to the same
 * rules.
 */
export function coerceValue(field: CaptureField, raw: unknown): string {
  if (raw === null || raw === undefined) return UNKNOWN;

  const text = String(typeof raw === 'object' ? JSON.stringify(raw) : raw).trim();
  if (text === '' || text.toLowerCase() === UNKNOWN || text.toLowerCase() === 'null') {
    return UNKNOWN;
  }

  if (field.kind === 'boolean') {
    const lowered = text.toLowerCase();
    if (['yes', 'true', 'y', '1'].includes(lowered)) return 'yes';
    if (['no', 'false', 'n', '0'].includes(lowered)) return 'no';
    return UNKNOWN;
  }

  if (field.kind === 'enum') {
    const match = (field.options ?? []).find(
      (option) => option.toLowerCase() === text.toLowerCase(),
    );
    return match ?? UNKNOWN;
  }

  return text.slice(0, 2000);
}

const MAX_OPEN_QUESTIONS = 5;
const MAX_QUESTION_LENGTH = 500;

/**
 * Keep only clear, distinct questions. Blanks, duplicates, and "unknown"
 * are dropped so a hesitant model reply cannot become a callback.
 */
export function coerceOpenQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const text = item.trim().replace(/\s+/g, ' ');
    const lowered = text.toLowerCase();
    if (!text || lowered === UNKNOWN || lowered === 'null') continue;
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    kept.push(text.slice(0, MAX_QUESTION_LENGTH));
    if (kept.length >= MAX_OPEN_QUESTIONS) break;
  }
  return kept;
}
