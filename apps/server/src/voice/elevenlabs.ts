/**
 * ElevenLabs Conversational AI backend. It is an audio bridge: guest frames go
 * up, generated frames come back down to the carrier, and the turns it reports
 * are normalized into our transcript shape. When the agent invokes the built-in
 * end_call tool, this bridge waits for that audio to finish and tells the
 * runner to hang up (DESIGN D14). No audio is stored.
 */
import { WebSocket } from 'ws';
import type { VoiceConfig } from '../config.ts';
import type { TranscriptTurn, VoiceBackend } from '../storage/types.ts';
import { fromElevenLabs, parseElevenLabsAudioFormat, toElevenLabs } from './audio.ts';
import { withOpeningTurn } from './opening.ts';
import {
  VoiceQuotaError,
  type VoiceBackendPort,
  type VoiceSession,
  type VoiceSessionContext,
} from './types.ts';

const API = 'https://api.elevenlabs.io/v1';
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', hi: 'Hindi' };
/** Telephony audio is 8 kHz mu-law: one byte is one sample. */
const MULAW_HZ = 8000;
/** Extra wait so the last samples are not clipped when the estimate is short. */
const GOODBYE_PAD_MS = 400;
const DEFAULT_END_DETAIL = 'agent ended the call';

/** Provider payloads we read. Everything else in the stream is ignored. */
interface AgentMessage {
  type?: string;
  audio_event?: { audio_base_64?: string };
  user_transcription_event?: { user_transcript?: string };
  agent_response_event?: { agent_response?: string };
  conversation_initiation_metadata_event?: {
    conversation_id?: string;
    agent_output_audio_format?: string;
    user_input_audio_format?: string;
  };
  ping_event?: { event_id?: number };
  agent_tool_request?: { tool_name?: string; parameters?: unknown };
  agent_tool_response?: { tool_name?: string; is_error?: boolean; is_called?: boolean };
}

/**
 * How long goodbye audio already sent to the phone still has to play.
 * Counting every byte from the start of the call would wait out audio the
 * guest has already heard, so the deadline only moves forward from now.
 */
export class GoodbyeDrain {
  private deadlineMs = 0;

  constructor(
    private readonly now: () => number,
    private readonly padMs: number,
  ) {}

  /** One telephony frame was handed to the carrier. */
  noteFrame(byteLength: number): void {
    if (byteLength <= 0) return;
    const durationMs = Math.ceil((byteLength / MULAW_HZ) * 1000);
    this.deadlineMs = Math.max(this.deadlineMs, this.now()) + durationMs;
  }

  /** The carrier dropped its queue, so nothing already sent still has to play. */
  clear(): void {
    this.deadlineMs = this.now();
  }

  /** Milliseconds to wait before hanging up, once the agent has decided. */
  waitMs(): number {
    return Math.max(0, this.deadlineMs - this.now()) + this.padMs;
  }
}

/** Whether the agent has invoked end_call, and the timeline detail to store. */
export interface EndCallSignal {
  ended: boolean;
  reason: string;
}

/** A call that has not been closed by the agent yet. */
export function createEndCallSignal(): EndCallSignal {
  return { ended: false, reason: DEFAULT_END_DETAIL };
}

/** Pull a short reason out of an end_call tool request, when the model sent one. */
function readEndReason(parameters: unknown): string | null {
  let value = parameters;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const reason = (value as { reason?: unknown }).reason;
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

/**
 * Record an end_call from one server event. Returns true only on the event
 * that successfully ends the call. A failed tool, or any other tool, does not.
 */
export function noteEndCall(signal: EndCallSignal, message: AgentMessage): boolean {
  if (signal.ended) return false;

  const request = message.agent_tool_request;
  if (message.type === 'agent_tool_request' && request && request.tool_name === 'end_call') {
    const reason = readEndReason(request.parameters);
    if (reason) signal.reason = `${DEFAULT_END_DETAIL}: ${reason}`;
    return false;
  }

  if (message.type !== 'agent_tool_response') return false;
  const response = message.agent_tool_response;
  if (response?.tool_name !== 'end_call') return false;
  if (response.is_error === true || response.is_called === false) {
    signal.reason = DEFAULT_END_DETAIL;
    return false;
  }

  signal.ended = true;
  return true;
}

/**
 * A socket close after the agent ended the call is a normal completion.
 * Any earlier close is still a backend failure.
 */
export function providerCloseError(
  signal: EndCallSignal,
  code: number,
  reason: Buffer | string,
): Error | null {
  if (signal.ended) return null;
  return elevenLabsCloseError(code, reason);
}

function isQuotaRefusal(status: number, body: string): boolean {
  if (status === 402 || status === 429) return true;
  return /quota|credit|insufficient|limit/i.test(body);
}

/** Turn an ElevenLabs socket close into an operator-facing error. */
export function elevenLabsCloseError(code: number, reason: Buffer | string): Error {
  const detail = typeof reason === 'string' ? reason : reason.toString() || 'no reason';
  const field = /override for field '([^']+)' is not allowed/i.exec(detail)?.[1];
  if (field) {
    return new Error(
      `elevenlabs rejected the ${field} override: enable ${field} on this agent under Security > Overrides`,
    );
  }
  return new Error(`elevenlabs closed the session (${code}): ${detail}`);
}

export class ElevenLabsBackend implements VoiceBackendPort {
  readonly backend: VoiceBackend = 'elevenlabs';

  constructor(private readonly config: VoiceConfig) {}

  /** Subscription character balance, which is what runs out in practice. */
  async hasCredits(): Promise<boolean> {
    const response = await fetch(`${API}/user/subscription`, {
      headers: { 'xi-api-key': this.config.apiKey },
    });
    if (!response.ok) return false;
    const body = (await response.json()) as {
      character_count?: number;
      character_limit?: number;
    };
    if (typeof body.character_limit !== 'number') return true;
    return (body.character_count ?? 0) < body.character_limit;
  }

  /**
   * Clear a dashboard greeting and set the provider's opening wait to the saved
   * number of seconds. After that silence, the provider starts the agent.
   */
  private async prepareOpening(openingWaitSeconds: number): Promise<void> {
    const url = `${API}/convai/agents/${encodeURIComponent(this.config.agentId)}`;
    const headers = {
      'xi-api-key': this.config.apiKey,
      'content-type': 'application/json',
    };
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return;
      const agent = (await response.json()) as unknown;
      const patch = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(withOpeningTurn(agent, openingWaitSeconds)),
        signal: AbortSignal.timeout(8_000),
      });
      await patch.arrayBuffer();
    } catch {
      return;
    }
  }

  /** Short-lived URL, so the API key never travels in a WebSocket query string. */
  private async signedUrl(): Promise<string> {
    const url = `${API}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(this.config.agentId)}`;
    const response = await fetch(url, { headers: { 'xi-api-key': this.config.apiKey } });
    const text = await response.text();
    if (!response.ok) {
      if (isQuotaRefusal(response.status, text)) {
        throw new VoiceQuotaError('elevenlabs', `elevenlabs refused on quota: ${text}`);
      }
      throw new Error(`elevenlabs signed url failed (${response.status}): ${text}`);
    }
    const body = JSON.parse(text) as { signed_url?: string };
    if (!body.signed_url) throw new Error('elevenlabs returned no signed url');
    return body.signed_url;
  }

  async start(ctx: VoiceSessionContext): Promise<VoiceSession> {
    await this.prepareOpening(Math.max(1, Math.round(ctx.openingWaitMs / 1000)));
    const signed = await this.signedUrl();
    const socket = new WebSocket(signed);

    let conversationId: string | null = null;
    let closed = false;
    let inputFormat = parseElevenLabsAudioFormat(undefined);
    let outputFormat = parseElevenLabsAudioFormat(undefined);
    let formatsReady = false;
    const queuedGuest: Buffer[] = [];
    const drain = new GoodbyeDrain(() => Date.now(), GOODBYE_PAD_MS);
    const signal = createEndCallSignal();
    let drainTimer: NodeJS.Timeout | null = null;

    /** Hang up only after audio already sent to the phone has had time to play. */
    const scheduleEnd = (): void => {
      if (drainTimer) clearTimeout(drainTimer);
      drainTimer = setTimeout(() => {
        drainTimer = null;
        if (closed) return;
        ctx.onAgentEnd(signal.reason);
      }, drain.waitMs());
    };

    /** Forward one telephony frame once we know ElevenLabs's input format. */
    const sendGuest = (frame: Buffer): void => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({ user_audio_chunk: toElevenLabs(frame, inputFormat).toString('base64') }),
      );
    };

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', (error: Error) => reject(error));
    });

    socket.send(
      JSON.stringify({
        type: 'conversation_initiation_client_data',
        conversation_config_override: {
          agent: {
            prompt: { prompt: ctx.prompt },
            language: ctx.language,
          },
        },
        dynamic_variables: {
          language_name: LANGUAGE_NAMES[ctx.language] ?? ctx.language,
        },
      }),
    );

    ctx.channel.onAudio((frame) => {
      if (!formatsReady) {
        queuedGuest.push(frame);
        return;
      }
      sendGuest(frame);
    });

    socket.on('message', (raw) => {
      let message: AgentMessage;
      try {
        message = JSON.parse(raw.toString()) as AgentMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'conversation_initiation_metadata': {
          const meta = message.conversation_initiation_metadata_event;
          conversationId = meta?.conversation_id ?? null;
          inputFormat = parseElevenLabsAudioFormat(meta?.user_input_audio_format);
          outputFormat = parseElevenLabsAudioFormat(meta?.agent_output_audio_format);
          formatsReady = true;
          for (const frame of queuedGuest) sendGuest(frame);
          queuedGuest.length = 0;
          break;
        }
        case 'audio': {
          const payload = message.audio_event?.audio_base_64;
          if (payload) {
            const frame = fromElevenLabs(Buffer.from(payload, 'base64'), outputFormat);
            ctx.channel.send(frame);
            drain.noteFrame(frame.length);
            if (signal.ended) scheduleEnd();
          }
          break;
        }
        case 'interruption':
          ctx.channel.clear();
          drain.clear();
          if (signal.ended) scheduleEnd();
          break;
        case 'ping':
          socket.send(
            JSON.stringify({
              type: 'pong',
              event_id: message.ping_event?.event_id,
            }),
          );
          break;
        case 'user_transcript': {
          const text = message.user_transcription_event?.user_transcript;
          if (text) ctx.onTranscript(turn('guest', text));
          break;
        }
        case 'agent_response': {
          const text = message.agent_response_event?.agent_response;
          if (text) ctx.onTranscript(turn('agent', text));
          break;
        }
        default:
          break;
      }

      if (noteEndCall(signal, message)) scheduleEnd();
    });

    socket.on('error', (error: Error) => {
      if (closed || signal.ended) return;
      ctx.onError(error);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      if (closed) return;
      // After end_call the provider often closes the socket itself. That is a
      // normal completion; the drain timer still hangs the phone up.
      const error = providerCloseError(signal, code, reason);
      if (error) ctx.onError(error);
    });

    return {
      get sessionId() {
        return conversationId;
      },
      close: async () => {
        closed = true;
        if (drainTimer) clearTimeout(drainTimer);
        if (socket.readyState === WebSocket.OPEN) socket.close();
      },
    };
  }
}

function turn(role: TranscriptTurn['role'], text: string): TranscriptTurn {
  return { role, text, at: new Date().toISOString() };
}
