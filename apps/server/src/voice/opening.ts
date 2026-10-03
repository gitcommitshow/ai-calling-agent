/**
 * Opening of an answered call. The guest gets a few seconds to speak first.
 * If they do not, the agent starts. If they still have not spoken when the
 * no-response limit is reached, the runner hangs up. Both durations come from
 * org settings.
 *
 * The provider opening wait is longer than a typical hangup, so its own timer
 * does not start a second greeting. Our nudge is what makes the agent speak.
 */
export const OPENING_PROVIDER_WAIT_SECONDS = 30;
/**
 * Hidden user turn that gives the model the opening. It is not a guest line
 * and is dropped if the provider echoes it into the transcript.
 */
export const OPENING_NUDGE =
  'The guest picked up and has stayed quiet. Start the call in one short, calm sentence.';

/** Whether this transcript line is the opening nudge rather than the guest. */
export function isOpeningNudge(text: string): boolean {
  return text.trim() === OPENING_NUDGE;
}

/**
 * The opening window has passed and neither side has started. The voice
 * backend should tell the agent to greet. `limitMs` is the saved wait.
 */
export function shouldNudgeOpening(input: {
  elapsedMs: number;
  limitMs: number;
  guestSpoke: boolean;
  agentStarted: boolean;
}): boolean {
  return input.elapsedMs >= input.limitMs && !input.guestSpoke && !input.agentStarted;
}

/** The guest has not spoken and the saved no-response limit has passed. */
export function shouldHangUpForNoResponse(input: {
  elapsedMs: number;
  limitMs: number;
  guestSpoke: boolean;
}): boolean {
  return input.elapsedMs >= input.limitMs && !input.guestSpoke;
}

/** Turn config from an agent payload. Empty when the payload has none. */
function readTurn(agent: unknown): Record<string, unknown> {
  if (!agent || typeof agent !== 'object') return {};
  const config = (agent as { conversation_config?: unknown }).conversation_config;
  if (!config || typeof config !== 'object') return {};
  const turn = (config as { turn?: unknown }).turn;
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) return {};
  return { ...(turn as Record<string, unknown>) };
}

/**
 * Agent patch for the opening. Clears a dashboard greeting so the guest gets
 * the wait, keeps the other turn settings, and holds the provider's own
 * opening timer past our hangup.
 */
export function withOpeningTurn(agent: unknown): {
  conversation_config: {
    agent: { first_message: string };
    turn: Record<string, unknown>;
  };
} {
  return {
    conversation_config: {
      agent: { first_message: '' },
      turn: { ...readTurn(agent), initial_wait_time: OPENING_PROVIDER_WAIT_SECONDS },
    },
  };
}
