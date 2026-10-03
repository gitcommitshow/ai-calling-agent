/**
 * Unit tests for picking the guest's last line out of a call transcript.
 */
import { expect } from 'chai';
import { lastGuestLine } from '../src/domain/transcript';
import type { TranscriptTurn } from '../src/domain/types';

function turn(role: TranscriptTurn['role'], text: string): TranscriptTurn {
  return { role, text, at: '2026-10-03T10:00:00.000Z' };
}

describe('lastGuestLine', () => {
  it('returns the latest guest line when the agent speaks after them', () => {
    const line = lastGuestLine([
      turn('agent', 'Can you make it?'),
      turn('guest', "I'll come"),
      turn('agent', 'See you there'),
    ]);
    expect(line).to.equal("I'll come");
  });

  it('returns null when the guest never spoke', () => {
    expect(lastGuestLine([turn('agent', 'Hello?')])).to.equal(null);
  });

  it('returns null for an empty transcript', () => {
    expect(lastGuestLine([])).to.equal(null);
  });
});
