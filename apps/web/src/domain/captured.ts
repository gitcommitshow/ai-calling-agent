/**
 * Answers taken off a finished call. Extraction writes "unknown" when a field
 * was missing or unclear, so the guest card only shows values that say something.
 */
import type { CaptureField } from './types';

export interface CapturedAnswer {
  key: string;
  label: string;
  value: string;
}

/** True when extraction stored a real answer rather than a blank or "unknown". */
function isAnswer(value: string | undefined): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text !== '' && text !== 'unknown';
}

/** Field answers to show, in the campaign's field order. Keys with no definition keep their key as the label. */
export function capturedAnswers(
  fields: Record<string, string>,
  definitions: Pick<CaptureField, 'key' | 'label'>[],
): CapturedAnswer[] {
  const known = new Set<string>();
  const answers: CapturedAnswer[] = [];
  for (const field of definitions) {
    known.add(field.key);
    const value = fields[field.key];
    if (!isAnswer(value)) continue;
    answers.push({ key: field.key, label: field.label, value: value.trim() });
  }
  for (const [key, value] of Object.entries(fields)) {
    if (known.has(key) || !isAnswer(value)) continue;
    answers.push({ key, label: key, value: value.trim() });
  }
  return answers;
}
