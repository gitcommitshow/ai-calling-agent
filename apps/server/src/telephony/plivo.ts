/**
 * Plivo adapter. Owns every Plivo concept: REST call creation, callback form
 * bodies, answer XML, answering machine detection, signature checks, and the
 * audio stream message format. Callers only ever see the telephony contract.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { TelephonyConfig } from '../config.ts';
import type {
  AudioChannel,
  CallEndReason,
  DialRequest,
  TelephonyEvent,
  TelephonyPort,
} from './types.ts';

const CALLBACK_PREFIX = '/telephony/plivo';
const PLIVO_API = 'https://api.plivo.com/v1';

/** Plivo's own call states, mapped to the neutral end reasons we store. */
const END_REASONS: Record<string, CallEndReason> = {
  completed: 'completed',
  busy: 'busy',
  'no-answer': 'no_answer',
  noanswer: 'no_answer',
  timeout: 'no_answer',
  cancel: 'rejected',
  rejected: 'rejected',
  declined: 'rejected',
  failed: 'failed',
};

/** One live call: its provider handle, its audio socket, and whether it ended. */
interface Session {
  attemptId: string;
  providerCallId: string | null;
  socket: WebSocket | null;
  streamId: string | null;
  audioListeners: ((frame: Buffer) => void)[];
  answered: boolean;
  terminal: boolean;
}

function formBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const fields: Record<string, string> = {};
  for (const [key, value] of params) fields[key] = value;
  return fields;
}

/**
 * String Plivo HMAC-SHA256s for a POST callback: callback URL, then `?` plus
 * sorted name+value pairs, then `.` plus the nonce.
 */
export function plivoV3PostPayload(
  uri: string,
  nonce: string,
  fields: Record<string, string>,
): string {
  const pairs = Object.keys(fields)
    .sort()
    .map((key) => `${key}${fields[key] ?? ''}`)
    .join('');
  return pairs.length > 0 ? `${uri}?${pairs}.${nonce}` : `${uri}.${nonce}`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Truthy machine-detection flag, whichever spelling the callback used. */
function machineDetected(fields: Record<string, string>): boolean {
  const raw = fields.Machine ?? fields.MachineDetection ?? fields.machine_detection ?? '';
  return raw.toLowerCase() === 'true';
}

export class PlivoTelephony implements TelephonyPort {
  readonly provider = 'plivo';

  private readonly sessions = new Map<string, Session>();
  private readonly listeners: ((event: TelephonyEvent) => void)[] = [];
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(
    private readonly config: TelephonyConfig,
    private readonly publicBaseUrl: string,
  ) {}

  onEvent(listener: (event: TelephonyEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: TelephonyEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private callbackUrl(kind: string, attemptId: string): string {
    return `${this.publicBaseUrl}${CALLBACK_PREFIX}/${kind}/${encodeURIComponent(attemptId)}`;
  }

  private streamUrl(attemptId: string): string {
    const base = this.publicBaseUrl.replace(/^http/, 'ws');
    return `${base}${CALLBACK_PREFIX}/stream/${encodeURIComponent(attemptId)}`;
  }

  async dial(request: DialRequest): Promise<{ providerCallId: string }> {
    const session: Session = {
      attemptId: request.attemptId,
      providerCallId: null,
      socket: null,
      streamId: null,
      audioListeners: [],
      answered: false,
      terminal: false,
    };
    this.sessions.set(request.attemptId, session);

    const auth = Buffer.from(`${this.config.authId}:${this.config.authToken}`).toString('base64');
    const response = await fetch(`${PLIVO_API}/Account/${this.config.authId}/Call/`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.config.callerId,
        to: request.to,
        answer_url: this.callbackUrl('answer', request.attemptId),
        answer_method: 'POST',
        hangup_url: this.callbackUrl('hangup', request.attemptId),
        hangup_method: 'POST',
        ring_url: this.callbackUrl('ring', request.attemptId),
        ring_method: 'POST',
        // Detect but do not act: we hang up ourselves so no message is left.
        machine_detection: 'true',
        machine_detection_time: 5000,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      request_uuid?: string;
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      this.sessions.delete(request.attemptId);
      throw new Error(
        `plivo refused the call (${response.status}): ${payload.error ?? payload.message ?? 'no detail'}`,
      );
    }

    const providerCallId = payload.request_uuid ?? '';
    session.providerCallId = providerCallId;
    return { providerCallId };
  }

  async hangup(attemptId: string): Promise<void> {
    const session = this.sessions.get(attemptId);
    if (!session) return;

    session.socket?.close();
    if (!session.providerCallId) return;

    const auth = Buffer.from(`${this.config.authId}:${this.config.authToken}`).toString('base64');
    await fetch(`${PLIVO_API}/Account/${this.config.authId}/Call/${session.providerCallId}/`, {
      method: 'DELETE',
      headers: { authorization: `Basic ${auth}` },
    }).catch(() => undefined);
  }

  /**
   * Verify Plivo's V3 callback signature over the URL we handed them, the POST
   * fields, and the nonce. The URL is rebuilt from our own configuration, so a
   * spoofed forwarding header cannot change what gets signed.
   */
  private signatureValid(
    req: IncomingMessage,
    kind: string,
    attemptId: string,
    fields: Record<string, string>,
  ): boolean {
    if (!this.config.verifySignature) return true;

    const header = req.headers['x-plivo-signature-v3'];
    const nonce = req.headers['x-plivo-signature-v3-nonce'];
    if (typeof header !== 'string' || typeof nonce !== 'string') return false;

    const expected = createHmac('sha256', this.config.authToken)
      .update(plivoV3PostPayload(this.callbackUrl(kind, attemptId), nonce, fields))
      .digest('base64');
    const expectedBytes = Buffer.from(expected);

    return header.split(',').some((candidate) => {
      const bytes = Buffer.from(candidate.trim());
      return bytes.length === expectedBytes.length && timingSafeEqual(bytes, expectedBytes);
    });
  }

  handleRequest(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
    if (!url.pathname.startsWith(`${CALLBACK_PREFIX}/`)) return false;

    const [, , , kind, rawAttemptId] = url.pathname.split('/');
    if (!kind || !rawAttemptId || kind === 'stream') return false;

    void this.respond(req, res, kind, decodeURIComponent(rawAttemptId));
    return true;
  }

  private async respond(
    req: IncomingMessage,
    res: ServerResponse,
    kind: string,
    attemptId: string,
  ): Promise<void> {
    const fields = formBody(await readBody(req));
    if (!this.signatureValid(req, kind, attemptId, fields)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('invalid plivo signature');
      return;
    }
    const session = this.sessions.get(attemptId);
    if (session && !session.providerCallId && fields.CallUUID) {
      session.providerCallId = fields.CallUUID;
    }

    if (kind === 'ring') {
      if (session && !session.terminal) this.emit({ attemptId, kind: 'ringing' });
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }

    if (kind === 'answer') {
      if (!session || session.terminal) {
        res.writeHead(200, { 'content-type': 'text/xml' }).end('<Response><Hangup/></Response>');
        return;
      }
      if (machineDetected(fields)) {
        this.emit({ attemptId, kind: 'machine_detected' });
        res.writeHead(200, { 'content-type': 'text/xml' }).end('<Response><Hangup/></Response>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/xml' }).end(this.answerXml(attemptId));
      return;
    }

    if (kind === 'hangup') {
      this.finish(attemptId, fields);
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' }).end('unknown plivo callback');
  }

  /** Bidirectional mu-law stream, kept alive so our side controls the hangup. */
  private answerXml(attemptId: string): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Response>',
      `<Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">${escapeXml(this.streamUrl(attemptId))}</Stream>`,
      '</Response>',
    ].join('');
  }

  /** Terminal callback. Repeats are ignored, so a retried webhook is harmless. */
  private finish(attemptId: string, fields: Record<string, string>): void {
    const session = this.sessions.get(attemptId);
    if (!session || session.terminal) return;
    session.terminal = true;

    const status = (fields.CallStatus ?? '').toLowerCase();
    const reason = END_REASONS[status] ?? (session.answered ? 'completed' : 'failed');
    const detail = fields.HangupCauseName ?? fields.HangupCause ?? status;

    session.socket?.close();
    session.socket = null;
    this.sessions.delete(attemptId);
    this.emit({ attemptId, kind: 'ended', reason, detail: detail || undefined });
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean {
    const prefix = `${CALLBACK_PREFIX}/stream/`;
    if (!url.pathname.startsWith(prefix)) return false;

    const attemptId = decodeURIComponent(url.pathname.slice(prefix.length));
    const session = this.sessions.get(attemptId);
    if (!session || session.terminal) {
      socket.destroy();
      return true;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      session.socket = ws;
      ws.on('message', (raw) => this.onStreamMessage(session, raw.toString()));
      ws.on('close', () => {
        if (session.socket === ws) session.socket = null;
      });
      ws.on('error', () => ws.close());
    });
    return true;
  }

  private onStreamMessage(session: Session, raw: string): void {
    let message: { event?: string; start?: { streamId?: string }; media?: { payload?: string } };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.event === 'start') {
      session.streamId = message.start?.streamId ?? null;
      if (session.answered) return;
      session.answered = true;
      this.emit({
        attemptId: session.attemptId,
        kind: 'answered',
        channel: this.channelFor(session),
      });
      return;
    }

    if (message.event === 'media' && message.media?.payload) {
      const frame = Buffer.from(message.media.payload, 'base64');
      for (const listener of session.audioListeners) listener(frame);
    }
  }

  /** Audio for one call, in Plivo's playAudio and clearAudio message shapes. */
  private channelFor(session: Session): AudioChannel {
    return {
      onAudio: (listener) => {
        session.audioListeners.push(listener);
      },
      send: (frame) => {
        session.socket?.send(
          JSON.stringify({
            event: 'playAudio',
            media: {
              contentType: 'audio/x-mulaw',
              sampleRate: 8000,
              payload: frame.toString('base64'),
            },
          }),
        );
      },
      clear: () => {
        session.socket?.send(JSON.stringify({ event: 'clearAudio' }));
      },
    };
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) session.socket?.close();
    this.sessions.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
