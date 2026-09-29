/**
 * Pipeline test calls go through the same dial path as guest calls, but skip
 * guest guardrails and never write a guest attempt. No live third-party services.
 */
import { expect } from 'chai';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sinon, { type SinonStub } from 'sinon';
import { createRequestListener } from '../src/api/routes.ts';
import { CallRunner } from '../src/runner/runner.ts';
import { defaultOrgSettings } from '../src/storage/settings.ts';
import { JsonStore } from '../src/storage/json-store.ts';
import type { CampaignRecord, EventRecord, GuestRecord } from '../src/storage/types.ts';
import type { AudioChannel, TelephonyEvent, TelephonyPort } from '../src/telephony/types.ts';
import type { VoiceBackendPort, VoiceSessionContext } from '../src/voice/types.ts';

const NOW = new Date('2026-10-05T10:30:00.000Z');
const LIMITS = { maxCallSeconds: 30, silenceSeconds: 30, dialTimeoutSeconds: 30 };
const FIXED_NUMBER = '+919800000001';
const OTHER_NUMBER = '+919800000002';

const startedEvent: EventRecord = {
  id: 'launch-party-1234abcd',
  name: 'Launch party',
  startsAt: '2026-09-01T12:30:00.000Z',
  endsAt: '2026-12-01T16:30:00.000Z',
  timezone: 'Asia/Kolkata',
  lastImport: null,
  createdAt: '2026-09-27T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
};

const upcomingEvent: EventRecord = {
  ...startedEvent,
  id: 'upcoming-meetup-1234abcd',
  name: 'Upcoming meetup',
  startsAt: '2026-10-20T12:30:00.000Z',
  endsAt: '2026-10-20T16:30:00.000Z',
};

function guest(eventId: string, id: string, phone: string): GuestRecord {
  return {
    id,
    sourceId: id,
    name: `Guest ${id}`,
    email: `${id}@example.com`,
    phone,
    approvalStatus: 'approved',
    ticketName: 'General',
    checkedInAt: null,
    registeredAt: null,
    attributes: {},
  };
}

function campaignFor(event: EventRecord, queue: string[]): CampaignRecord {
  return {
    id: `pre-event-${event.id.slice(0, 8)}`,
    eventId: event.id,
    type: 'pre-event',
    name: 'Pre-event reminder',
    prompt: 'Remind {{guest.firstName}} about {{event.name}}.',
    useMasterPrompt: false,
    language: 'en',
    fields: [{ key: 'will_attend', label: 'Will they attend?', kind: 'enum', options: ['yes', 'no'] }],
    callingWindow: { start: '10:00', end: '11:00', timezone: 'Asia/Kolkata' },
    retryCap: 1,
    voiceBackendOrder: ['elevenlabs'],
    queue,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

const silentChannel: AudioChannel = { onAudio: () => {}, send: () => {}, clear: () => {} };

/** Telephony that answers immediately, so tests can inspect what was dialed. */
class FakeCarrier implements TelephonyPort {
  readonly provider = 'fake-carrier';
  readonly dialed: string[] = [];
  private readonly listeners: ((event: TelephonyEvent) => void)[] = [];
  private counter = 0;

  onEvent(listener: (event: TelephonyEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: TelephonyEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async dial({ attemptId, to }: { attemptId: string; to: string }) {
    this.dialed.push(to);
    this.emit({ attemptId, kind: 'ringing' });
    this.emit({ attemptId, kind: 'answered', channel: silentChannel });
    return { providerCallId: `pc-${++this.counter}` };
  }

  endCall(attemptId: string): void {
    this.emit({ attemptId, kind: 'ended', reason: 'completed', detail: 'guest hung up' });
  }

  async hangup(attemptId: string): Promise<void> {
    this.endCall(attemptId);
  }

  handleRequest(): boolean {
    return false;
  }

  handleUpgrade(): boolean {
    return false;
  }

  async close(): Promise<void> {}
}

/** Voice backend that records the prompt; `hold` keeps the call live. */
class FakeVoice implements VoiceBackendPort {
  readonly backend = 'elevenlabs' as const;
  readonly prompts: string[] = [];
  hold = false;

  constructor(private readonly afterTurns: (attemptId: string) => void) {}

  async hasCredits(): Promise<boolean> {
    return true;
  }

  async start(ctx: VoiceSessionContext) {
    this.prompts.push(ctx.prompt);
    const at = NOW.toISOString();
    ctx.onTranscript({ role: 'agent', text: 'Can you hear me?', at });
    ctx.onTranscript({ role: 'guest', text: 'Yes, clearly.', at });
    if (!this.hold) setImmediate(() => this.afterTurns(ctx.attemptId));
    return { sessionId: `sess-${ctx.attemptId}`, close: async () => {} };
  }
}

async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('pipeline test calls', () => {
  let dataDir: string;
  let store: JsonStore;
  let telephony: FakeCarrier;
  let voice: FakeVoice;
  let extract: SinonStub;
  let runner: CallRunner;
  let server: Server;
  let origin: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'calling-agent-test-call-'));
    store = new JsonStore(dataDir);
    telephony = new FakeCarrier();
    voice = new FakeVoice((attemptId) => telephony.endCall(attemptId));
    extract = sinon.stub().resolves({ will_attend: 'yes' });
    runner = new CallRunner({
      storage: store,
      telephony,
      voice,
      extraction: { provider: 'fake-llm', extract },
      limits: LIMITS,
      now: () => NOW,
      log: () => {},
    });

    await store.putSettings({ ...defaultOrgSettings(), testNumber: FIXED_NUMBER });

    const listener = createRequestListener(store, {
      runner,
      telephony,
      missingConfig: () => [],
    });
    server = createServer(listener);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server has no port');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (runner.activeRun) await runner.stopRun(runner.activeRun);
    await waitFor(async () => runner.activeRun === null, 'the runner to release the live call');
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  });

  async function post(path: string, body: unknown): Promise<{ status: number; payload: Record<string, unknown> }> {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
  }

  it('one-clicks the fixed number with the event prompt even outside guest guardrails', async () => {
    const asha = guest(startedEvent.id, 'asha', '+919876543210');
    const campaign = campaignFor(startedEvent, [asha.id]);
    await store.putEvent(startedEvent);
    await store.replaceGuests(startedEvent.id, [asha]);
    await store.putCampaign(campaign);

    const { status, payload } = await post('/test-calls', { eventId: startedEvent.id });
    expect(status).to.equal(202);
    const started = payload.testCall as { id: string };

    await waitFor(
      async () => (await store.getTestCall(started.id))?.status === 'done',
      'the test call to finish',
    );

    expect(telephony.dialed).to.deep.equal([FIXED_NUMBER]);
    expect(voice.prompts[0]).to.contain('Launch party').and.contain('Test attendee');
    expect(await store.listAttempts(startedEvent.id)).to.deep.equal([]);
  });

  it('dials a typed number with a new prompt and leaves the campaign prompt unchanged', async () => {
    const campaign = campaignFor(startedEvent, []);
    await store.putEvent(startedEvent);
    await store.putCampaign(campaign);

    const custom = 'Say only the words pipeline custom check.';
    const { status, payload } = await post('/test-calls', {
      eventId: startedEvent.id,
      to: OTHER_NUMBER,
      promptSource: { kind: 'custom', prompt: custom },
    });
    expect(status).to.equal(202);
    const started = payload.testCall as { id: string };

    await waitFor(
      async () => (await store.getTestCall(started.id))?.status === 'done',
      'the custom test call to finish',
    );

    expect(telephony.dialed).to.deep.equal([OTHER_NUMBER]);
    expect(voice.prompts[0]).to.contain(custom);
    expect((await store.getCampaign(startedEvent.id, campaign.id))?.prompt).to.equal(campaign.prompt);
    expect(await store.listAttempts(startedEvent.id)).to.deep.equal([]);
  });

  it('returns 409 and does not dial when a guest run is already live', async () => {
    voice.hold = true;
    const asha = guest(upcomingEvent.id, 'asha', '+919876543210');
    const campaign = {
      ...campaignFor(upcomingEvent, [asha.id]),
      callingWindow: { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
    };
    await store.putEvent(upcomingEvent);
    await store.replaceGuests(upcomingEvent.id, [asha]);
    await store.putCampaign(campaign);

    await runner.startRun(campaign, { kind: 'queue' });
    await waitFor(async () => telephony.dialed.length === 1, 'the guest run to dial');

    const { status } = await post('/test-calls', { eventId: upcomingEvent.id });
    expect(status).to.equal(409);
    expect(telephony.dialed).to.deep.equal([asha.phone]);
  });
});
