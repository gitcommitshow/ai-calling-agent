/**
 * Opening of an answered call. The guest gets a few seconds to speak first.
 * If they do not, the provider starts the agent. If they still have not spoken
 * when the no-response limit is reached, the runner hangs up. Both durations
 * come from org settings.
 */

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
 * the wait, keeps the other turn settings, and tells the provider to start
 * the agent after `openingWaitSeconds` of silence.
 */
export function withOpeningTurn(
  agent: unknown,
  openingWaitSeconds: number,
): {
  conversation_config: {
    agent: { first_message: string };
    turn: Record<string, unknown>;
  };
} {
  return {
    conversation_config: {
      agent: { first_message: '' },
      turn: { ...readTurn(agent), initial_wait_time: openingWaitSeconds },
    },
  };
}
