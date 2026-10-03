/**
 * Opening wait and no-response hangup. No live provider.
 */
import { expect } from 'chai';
import {
  OPENING_NUDGE,
  isOpeningNudge,
  shouldHangUpForNoResponse,
  shouldNudgeOpening,
  withOpeningTurn,
} from '../src/voice/opening.ts';

describe('call opening', () => {
  it('starts the agent after 3 quiet seconds and hangs up at 15', () => {
    expect(
      shouldNudgeOpening({ elapsedMs: 3_000, limitMs: 3_000, guestSpoke: false, agentStarted: false }),
    ).to.equal(true);
    expect(
      shouldHangUpForNoResponse({ elapsedMs: 15_000, limitMs: 15_000, guestSpoke: false }),
    ).to.equal(true);
    expect(isOpeningNudge(`  ${OPENING_NUDGE}  `)).to.equal(true);
  });

  it('leaves the call alone when someone already spoke, or the window is still open', () => {
    expect(
      shouldNudgeOpening({ elapsedMs: 2_999, limitMs: 3_000, guestSpoke: false, agentStarted: false }),
    ).to.equal(false);
    expect(
      shouldNudgeOpening({ elapsedMs: 4_000, limitMs: 3_000, guestSpoke: true, agentStarted: false }),
    ).to.equal(false);
    expect(
      shouldNudgeOpening({ elapsedMs: 4_000, limitMs: 3_000, guestSpoke: false, agentStarted: true }),
    ).to.equal(false);
    expect(
      shouldHangUpForNoResponse({ elapsedMs: 15_000, limitMs: 15_000, guestSpoke: true }),
    ).to.equal(false);
    expect(isOpeningNudge('Hello, who is this?')).to.equal(false);
  });

  it('clears a saved greeting and keeps the other turn settings', () => {
    const patch = withOpeningTurn({
      conversation_config: {
        agent: { first_message: 'Hi, this is a reminder.' },
        turn: { turn_timeout: 7, turn_eagerness: 'normal' },
      },
    });
    expect(patch.conversation_config.agent.first_message).to.equal('');
    expect(patch.conversation_config.turn).to.deep.equal({
      turn_timeout: 7,
      turn_eagerness: 'normal',
      initial_wait_time: 30,
    });
  });
});
