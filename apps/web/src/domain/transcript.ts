/**
 * Transcript display helpers. The queue shows one folded line per call, so
 * the last thing the guest said has to be picked out of the full turn list.
 */
import type { TranscriptTurn } from './types';

/** Newest non-blank line the guest said, or null when they never spoke. */
export function lastGuestLine(transcript: TranscriptTurn[]): string | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const turn = transcript[index];
    if (!turn || turn.role !== 'guest') continue;
    const text = turn.text.trim();
    if (text) return text;
  }
  return null;
}
