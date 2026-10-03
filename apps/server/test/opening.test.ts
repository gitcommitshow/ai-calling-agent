/**
 * Opening wait and no-response hangup. No live provider.
 */
import { expect } from 'chai';
import { shouldHangUpForNoResponse, withOpeningTurn } from '../src/voice/opening.ts';

describe('call opening', () => {
  it('hangs up once a silent guest reaches the saved limit', () => {
    expect(
      shouldHangUpForNoResponse({ elapsedMs: 15_000, limitMs: 15_000, guestSpoke: false }),
    ).to.equal(true);
  });

  it('keeps the line when the guest has spoken, or the limit is still ahead', () => {
    expect(
      shouldHangUpForNoResponse({ elapsedMs: 14_999, limitMs: 15_000, guestSpoke: false }),
    ).to.equal(false);
    expect(
      shouldHangUpForNoResponse({ elapsedMs: 15_000, limitMs: 15_000, guestSpoke: true }),
    ).to.equal(false);
  });

  it('clears a saved greeting and waits the configured seconds before the agent speaks', () => {
    const patch = withOpeningTurn(
      {
        conversation_config: {
          agent: { first_message: 'Hi, this is a reminder.' },
          turn: { turn_timeout: 7, turn_eagerness: 'normal' },
        },
      },
      3,
    );
    expect(patch.conversation_config.agent.first_message).to.equal('');
    expect(patch.conversation_config.turn).to.deep.equal({
      turn_timeout: 7,
      turn_eagerness: 'normal',
      initial_wait_time: 3,
    });
  });
});
