/**
 * End call tool read and write. No live ElevenLabs API.
 */
import { expect } from 'chai';
import {
  DEFAULT_HANGUP_DESCRIPTION,
  applyAgentHangup,
  parseAgentHangupInput,
  readAgentHangup,
} from '../src/voice/agent-hangup.ts';

const agent = {
  conversation_config: {
    agent: {
      prompt: {
        built_in_tools: {
          end_call: {
            type: 'system',
            name: 'end_call',
            description: 'End when they confirm attendance.',
            response_timeout_secs: 20,
            params: { system_tool_type: 'end_call' },
          },
          language_detection: { name: 'language_detection' },
        },
      },
    },
  },
};

describe('agent hangup tool', () => {
  it('reads an enabled tool and updates only its instructions', () => {
    expect(readAgentHangup(agent)).to.deep.equal({
      enabled: true,
      description: 'End when they confirm attendance.',
    });

    const tools = applyAgentHangup(agent, {
      enabled: true,
      description: 'End after the attendance answer.',
    });
    expect(tools.language_detection).to.deep.equal({ name: 'language_detection' });
    expect(tools.end_call).to.deep.equal({
      type: 'system',
      name: 'end_call',
      description: 'End after the attendance answer.',
      response_timeout_secs: 20,
      params: { system_tool_type: 'end_call' },
    });
  });

  it('treats a missing tool as off, and enabling adds it beside the others', () => {
    const off = {
      conversation_config: {
        agent: {
          prompt: {
            built_in_tools: { end_call: null, skip_turn: { name: 'skip_turn' } },
          },
        },
      },
    };
    expect(readAgentHangup({})).to.deep.equal({ enabled: false, description: '' });
    expect(readAgentHangup(off).enabled).to.equal(false);

    const parsed = parseAgentHangupInput({ enabled: true, description: '  ' });
    expect(parsed.description).to.equal(DEFAULT_HANGUP_DESCRIPTION);
    const tools = applyAgentHangup(off, parsed);
    expect(tools.skip_turn).to.deep.equal({ name: 'skip_turn' });
    expect(tools.end_call).to.deep.equal({
      type: 'system',
      name: 'end_call',
      description: DEFAULT_HANGUP_DESCRIPTION,
      params: { system_tool_type: 'end_call' },
    });
  });

  it('rejects a bad save, and turning the tool off leaves the other tools', () => {
    expect(() => parseAgentHangupInput({ enabled: 'yes' })).to.throw(
      'enabled must be true or false',
    );
    const tools = applyAgentHangup(agent, { enabled: false, description: 'ignored' });
    expect(tools.end_call).to.equal(null);
    expect(tools.language_detection).to.deep.equal({ name: 'language_detection' });
  });
});
