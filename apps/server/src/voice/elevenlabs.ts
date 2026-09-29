/**
 * ElevenLabs Conversational AI backend. It is an audio bridge, nothing more:
 * guest frames go up, generated frames come back down to the carrier, and the
 * turns it reports are normalized into our transcript shape. No audio is stored.
 */
import { WebSocket } from 'ws';
import type { VoiceConfig } from '../config.ts';
import type { TranscriptTurn, VoiceBackend } from '../storage/types.ts';
import { fromElevenLabs, parseElevenLabsAudioFormat, toElevenLabs } from './audio.ts';
import {
  VoiceQuotaError,
  type VoiceBackendPort,
  type VoiceSession,
  type VoiceSessionContext,
} from './types.ts';

const API = 'https://api.elevenlabs.io/v1';
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', hi: 'Hindi' };

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
    const signed = await this.signedUrl();
    const socket = new WebSocket(signed);

    let conversationId: string | null = null;
    let closed = false;
    let inputFormat = parseElevenLabsAudioFormat(undefined);
    let outputFormat = parseElevenLabsAudioFormat(undefined);
    let formatsReady = false;
    const queuedGuest: Buffer[] = [];

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
            ctx.channel.send(fromElevenLabs(Buffer.from(payload, 'base64'), outputFormat));
          }
          break;
        }
        case 'interruption':
          ctx.channel.clear();
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
    });

    socket.on('error', (error: Error) => {
      if (closed) return;
      ctx.onError(error);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      if (closed) return;
      // The runner ends the attempt on the call's own end event, so an early
      // provider close is only an error when the call is still up.
      ctx.onError(elevenLabsCloseError(code, reason));
    });

    return {
      get sessionId() {
        return conversationId;
      },
      close: async () => {
        closed = true;
        if (socket.readyState === WebSocket.OPEN) socket.close();
      },
    };
  }
}

function turn(role: TranscriptTurn['role'], text: string): TranscriptTurn {
  return { role, text, at: new Date().toISOString() };
}
