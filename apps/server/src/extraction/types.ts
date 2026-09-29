/**
 * Extraction contract. One shared step turns a finished transcript into the
 * campaign's captured fields, so results from different voice backends stay
 * comparable (DESIGN D3).
 */
import type { CaptureField, Language, TranscriptTurn } from '../storage/types.ts';

export interface ExtractionRequest {
  fields: CaptureField[];
  transcript: TranscriptTurn[];
  language: Language;
}

export interface ExtractionPort {
  readonly provider: string;
  /**
   * One value per requested field. Anything missing, unclear, or failing
   * validation comes back as `unknown` rather than a guess.
   */
  extract(request: ExtractionRequest): Promise<Record<string, string>>;
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
