/**
 * The ElevenLabs agent's End call tool. Spoken goodbye does not drop the line.
 * The model has to invoke this tool, and the runner then hangs up (DESIGN D14).
 * The tool lives on the agent, so settings read and write it there. A per-call
 * prompt override cannot add it.
 */
import type { VoiceConfig } from '../config.ts';

const API = 'https://api.elevenlabs.io/v1';
/** Bound a settings-page read so a quiet provider cannot stall the page. */
const REQUEST_MS = 8_000;
/** Custom "when to hang up" text. Keep in step with the web settings constant. */
export const HANGUP_DESCRIPTION_MAX = 4000;
/**
 * Instruction used when the admin leaves the field blank. The model hangs up
 * by calling the tool after it has said goodbye.
 */
export const DEFAULT_HANGUP_DESCRIPTION = 'Hang up after you say goodbye.';

/** What the admin can see and change. A blank description is saved as the default. */
export interface AgentHangupSettings {
  enabled: boolean;
  description: string;
}

/** Read and update the End call tool on one ElevenLabs agent. */
export interface VoiceHangupPort {
  readonly agentId: string;
  read(): Promise<AgentHangupSettings>;
  update(next: AgentHangupSettings): Promise<AgentHangupSettings>;
}

/** Pull the system-tool map off an agent payload. Null when the shape is absent. */
function builtInTools(agent: unknown): Record<string, unknown> | null {
  if (!agent || typeof agent !== 'object') return null;
  const config = (agent as { conversation_config?: unknown }).conversation_config;
  if (!config || typeof config !== 'object') return null;
  const agentConfig = (config as { agent?: unknown }).agent;
  if (!agentConfig || typeof agentConfig !== 'object') return null;
  const prompt = (agentConfig as { prompt?: unknown }).prompt;
  if (!prompt || typeof prompt !== 'object') return null;
  const tools = (prompt as { built_in_tools?: unknown }).built_in_tools;
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return null;
  return tools as Record<string, unknown>;
}

/**
 * Current End call tool. An object means the agent may hang up. Null, or a
 * missing tool, means it cannot.
 */
export function readAgentHangup(agent: unknown): AgentHangupSettings {
  const endCall = builtInTools(agent)?.end_call;
  if (!endCall || typeof endCall !== 'object' || Array.isArray(endCall)) {
    return { enabled: false, description: '' };
  }
  const description = (endCall as { description?: unknown }).description;
  return {
    enabled: true,
    description: typeof description === 'string' ? description : '',
  };
}

/**
 * The system-tool map to save. Only the end_call entry changes, so language
 * detection and the other tools stay as the agent has them now.
 */
export function applyAgentHangup(
  agent: unknown,
  next: AgentHangupSettings,
): Record<string, unknown> {
  const tools: Record<string, unknown> = { ...(builtInTools(agent) ?? {}) };
  if (!next.enabled) {
    tools.end_call = null;
    return tools;
  }

  const current = tools.end_call;
  const existing =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  const params =
    existing.params && typeof existing.params === 'object' && !Array.isArray(existing.params)
      ? { ...(existing.params as Record<string, unknown>) }
      : {};

  tools.end_call = {
    ...existing,
    type: 'system',
    name: 'end_call',
    description: next.description,
    params: { ...params, system_tool_type: 'end_call' },
  };
  return tools;
}

/** Validate a settings save. Throws a short message the API can show as-is. */
export function parseAgentHangupInput(body: unknown): AgentHangupSettings {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('enabled is required');
  }
  const record = body as { enabled?: unknown; description?: unknown };
  if (typeof record.enabled !== 'boolean') {
    throw new Error('enabled must be true or false');
  }
  if (!record.enabled) return { enabled: false, description: '' };
  if (record.description !== undefined && typeof record.description !== 'string') {
    throw new Error('description must be text');
  }
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  if (description.length > HANGUP_DESCRIPTION_MAX) {
    throw new Error(`description must be ${HANGUP_DESCRIPTION_MAX} characters or fewer`);
  }
  return { enabled: true, description: description || DEFAULT_HANGUP_DESCRIPTION };
}

/** One short provider error. The body is clipped and the API key is never included. */
function providerError(action: string, status: number, body: string): Error {
  const detail = body.replace(/\s+/g, ' ').trim().slice(0, 240);
  const suffix = detail ? `: ${detail}` : '';
  return new Error(`elevenlabs could not ${action} the agent (${status})${suffix}`);
}

/**
 * Reads and updates the End call tool on the configured agent. Other agent
 * settings are left in place.
 */
export class ElevenLabsAgentHangup implements VoiceHangupPort {
  readonly agentId: string;

  constructor(private readonly config: Pick<VoiceConfig, 'apiKey' | 'agentId'>) {
    this.agentId = config.agentId;
  }

  /** The tool as ElevenLabs has it now. */
  async read(): Promise<AgentHangupSettings> {
    return readAgentHangup(await this.request('GET'));
  }

  /** Turn the tool on or off, and replace its instructions when it stays on. */
  async update(next: AgentHangupSettings): Promise<AgentHangupSettings> {
    const agent = await this.request('GET');
    await this.request('PATCH', {
      conversation_config: {
        agent: { prompt: { built_in_tools: applyAgentHangup(agent, next) } },
      },
    });
    const updated = await this.read();
    if (updated.enabled !== next.enabled) {
      throw new Error('elevenlabs did not confirm the hangup tool change');
    }
    if (next.enabled && updated.description !== next.description) {
      throw new Error('elevenlabs did not confirm the hangup instructions');
    }
    return updated;
  }

  /** GET or PATCH the agent. A timeout or a non-JSON body becomes an operator error. */
  private async request(method: 'GET' | 'PATCH', body?: unknown): Promise<unknown> {
    const url = `${API}/convai/agents/${encodeURIComponent(this.config.agentId)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'xi-api-key': this.config.apiKey,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error('elevenlabs did not answer in time');
      }
      const message = error instanceof Error ? error.message : 'network error';
      throw new Error(`elevenlabs could not be reached: ${message}`);
    }

    const text = await response.text();
    if (!response.ok) throw providerError(method === 'GET' ? 'read' : 'update', response.status, text);
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('elevenlabs returned a response this server could not read');
    }
  }
}
