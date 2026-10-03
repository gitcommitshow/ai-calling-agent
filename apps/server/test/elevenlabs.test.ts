/**
 * Maps ElevenLabs socket closes to operator-facing errors. No live API.
 */
import { expect } from 'chai';
import {
  GoodbyeDrain,
  createEndCallSignal,
  elevenLabsCloseError,
  noteEndCall,
  providerCloseError,
} from '../src/voice/elevenlabs.ts';

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

describe('agent end call', () => {
  it('ends only on a successful end_call, and a later socket close is normal', () => {
    const signal = createEndCallSignal();
    expect(
      noteEndCall(signal, {
        type: 'agent_tool_response',
        agent_tool_response: { tool_name: 'transfer_to_number', is_error: false },
      }),
    ).to.equal(false);
    expect(
      noteEndCall(signal, {
        type: 'agent_tool_response',
        agent_tool_response: { tool_name: 'end_call', is_error: true },
      }),
    ).to.equal(false);
    expect(providerCloseError(signal, 1006, 'abnormal')).to.be.instanceOf(Error);
    expect(providerCloseError(signal, 1000, '')).to.equal(null);

    expect(
      noteEndCall(signal, {
        type: 'agent_tool_request',
        agent_tool_request: {
          tool_name: 'end_call',
          parameters: { reason: 'User asked to end the call' },
        },
      }),
    ).to.equal(false);
    expect(
      noteEndCall(signal, {
        type: 'agent_tool_response',
        agent_tool_response: { tool_name: 'end_call', is_error: false },
      }),
    ).to.equal(true);
    expect(signal.reason).to.equal('agent ended the call: User asked to end the call');
    expect(providerCloseError(signal, 1000, '')).to.equal(null);
  });

  it('waits out queued goodbye audio, then only a short pad', () => {
    let now = 1_000;
    const drain = new GoodbyeDrain(() => now, 400);
    drain.noteFrame(8000);
    expect(drain.waitMs()).to.equal(1400);
    now = 2_000;
    expect(drain.waitMs()).to.equal(400);
    drain.clear();
    drain.noteFrame(16000);
    expect(drain.waitMs()).to.equal(2400);
  });
});
