/**
 * Integration test for the Plivo adapter's translation layer. No live
 * third-party services: the REST dial is stubbed, and the callbacks and audio
 * socket are driven against a local server the way Plivo would drive them.
 */
import { expect } from 'chai';
import sinon from 'sinon';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { PlivoTelephony, plivoV3PostPayload } from '../src/telephony/plivo.ts';
import type { AudioChannel, TelephonyEvent } from '../src/telephony/types.ts';

const ATTEMPT_ID = '20261005103000-aaaaaaaa';
const AUTH_TOKEN = 'test-token';
const SIGN_NONCE = 'test-nonce';

/** HMAC Plivo would send for a POST callback in these tests. */
function signV3(url: string, fields: Record<string, string>): string {
  return createHmac('sha256', AUTH_TOKEN)
    .update(plivoV3PostPayload(url, SIGN_NONCE, fields))
    .digest('base64');
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('PlivoTelephony', () => {
  let telephony: PlivoTelephony;
  let server: Server;
  let baseUrl: string;
  let events: TelephonyEvent[];

  beforeEach(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!telephony.handleRequest(req, res, url)) res.writeHead(404).end();
    });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!telephony.handleUpgrade(req, socket, head, url)) socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    telephony = new PlivoTelephony(
      {
        provider: 'plivo',
        authId: 'MAXXXXXXXXXXXXXXXXXX',
        authToken: 'test-token',
        callerId: '+911140000000',
        verifySignature: true,
      },
      baseUrl,
    );

    events = [];
    telephony.onEvent((event) => events.push(event));
  });

  afterEach(async () => {
    sinon.restore();
    await telephony.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function dial(): Promise<void> {
    const fetchStub = sinon
      .stub(globalThis, 'fetch')
      .resolves(new Response(JSON.stringify({ request_uuid: 'ru-1' }), { status: 200 }));

    const { providerCallId } = await telephony.dial({
      attemptId: ATTEMPT_ID,
      to: '+919876543210',
    });
    expect(providerCallId).to.equal('ru-1');

    const request = JSON.parse(String(fetchStub.firstCall.args[1]?.body)) as Record<string, string>;
    expect(request.to).to.equal('+919876543210');
    expect(request.answer_url).to.equal(`${baseUrl}/telephony/plivo/answer/${ATTEMPT_ID}`);
    expect(request.machine_detection).to.equal('true');
    fetchStub.restore();
  }

  function callback(kind: string, fields: Record<string, string>, signature?: string | null) {
    const url = `${baseUrl}/telephony/plivo/${kind}/${ATTEMPT_ID}`;
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (signature !== null) {
      headers['X-Plivo-Signature-V3'] = signature ?? signV3(url, fields);
      headers['X-Plivo-Signature-V3-Nonce'] = SIGN_NONCE;
    }
    return fetch(url, {
      method: 'POST',
      headers,
      body: new URLSearchParams(fields).toString(),
    });
  }

  it('bridges the audio stream and reports one ended event per call', async () => {
    await dial();

    // Plivo asks what to do with the answered call.
    const answer = await callback('answer', { CallUUID: 'cu-1', CallStatus: 'in-progress' });
    const xml = await answer.text();
    expect(answer.status).to.equal(200);
    expect(xml).to.contain('bidirectional="true"');
    expect(xml).to.contain('audio/x-mulaw;rate=8000');
    expect(xml).to.contain(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/telephony/plivo/stream/${ATTEMPT_ID}`);

    // Plivo opens the audio socket and starts streaming the guest.
    const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/telephony/plivo/stream/${ATTEMPT_ID}`);
    const fromServer: string[] = [];
    socket.on('message', (raw) => fromServer.push(raw.toString()));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    socket.send(JSON.stringify({ event: 'start', start: { streamId: 's1', callId: 'cu-1' } }));
    await waitFor(() => events.some((event) => event.kind === 'answered'), 'the answered event');

    const answered = events.find((event) => event.kind === 'answered');
    if (answered?.kind !== 'answered') throw new Error('the adapter reported no answered event');

    const channel: AudioChannel = answered.channel;
    const heard: Buffer[] = [];
    channel.onAudio((frame) => heard.push(frame));

    socket.send(
      JSON.stringify({
        event: 'media',
        media: { track: 'inbound', payload: Buffer.from('guest-audio').toString('base64') },
      }),
    );
    await waitFor(() => heard.length > 0, 'a guest audio frame');
    expect(heard[0]?.toString()).to.equal('guest-audio');

    // Agent audio goes back in Plivo's own playback message shape.
    channel.send(Buffer.from('agent-audio'));
    await waitFor(() => fromServer.length > 0, 'a playback message');
    expect(JSON.parse(fromServer[0]!)).to.deep.equal({
      event: 'playAudio',
      media: {
        contentType: 'audio/x-mulaw',
        sampleRate: 8000,
        payload: Buffer.from('agent-audio').toString('base64'),
      },
    });

    // A webhook Plivo retries must not end the call twice.
    await callback('hangup', { CallStatus: 'completed', HangupCauseName: 'NORMAL_CLEARING' });
    await callback('hangup', { CallStatus: 'completed', HangupCauseName: 'NORMAL_CLEARING' });

    const ended = events.filter((event) => event.kind === 'ended');
    expect(ended).to.have.lengthOf(1);
    expect(ended[0]).to.include({ reason: 'completed', detail: 'NORMAL_CLEARING' });
  });

  it('builds the V3 POST payload the same way Plivo signs it', () => {
    expect(
      plivoV3PostPayload('https://calls.example.com/telephony/plivo/answer/a1', 'n1', {
        CallUUID: 'cu-1',
        CallStatus: 'in-progress',
        To: '+91',
      }),
    ).to.equal(
      'https://calls.example.com/telephony/plivo/answer/a1?CallStatusin-progressCallUUIDcu-1To+91.n1',
    );
  });

  it('rejects a callback whose V3 signature is missing or does not match', async () => {
    await dial();

    const unsigned = await callback('answer', { CallUUID: 'cu-1' }, null);
    expect(unsigned.status).to.equal(403);
    expect(await unsigned.text()).to.equal('invalid plivo signature');

    const forged = await callback('answer', { CallUUID: 'cu-1' }, 'not-a-real-signature');
    expect(forged.status).to.equal(403);
  });
});
