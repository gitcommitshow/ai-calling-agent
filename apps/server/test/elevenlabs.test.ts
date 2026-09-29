/**
 * Maps ElevenLabs socket closes to operator-facing errors. No live API.
 */
import { expect } from 'chai';
import { elevenLabsCloseError } from '../src/voice/elevenlabs.ts';

describe('elevenLabsCloseError', () => {
  it('keeps a generic close reason and code', () => {
    const error = elevenLabsCloseError(1000, 'no reason');
    expect(error.message).to.equal('elevenlabs closed the session (1000): no reason');
  });

  it('names the Security toggle when an override is refused', () => {
    const error = elevenLabsCloseError(
      1008,
      "Override for field 'prompt' is not allowed by config.",
    );
    expect(error.message).to.equal(
      'elevenlabs rejected the prompt override: enable prompt on this agent under Security > Overrides',
    );
  });
});
