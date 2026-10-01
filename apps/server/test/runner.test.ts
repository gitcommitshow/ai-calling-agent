/**
 * Integration tests for the sequential runner. No live third-party services:
 * telephony, the voice backend, and extraction are all fakes, and the store is
 * a temporary folder.
 */
import { expect } from 'chai';
import sinon, { type SinonStub } from 'sinon';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CallRunner } from '../src/runner/runner.ts';
import { JsonStore } from '../src/storage/json-store.ts';
import type {
  AttemptRecord,
  CampaignRecord,
  EventRecord,
  GuestRecord,
} from '../src/storage/types.ts';
import type { AudioChannel, TelephonyEvent, TelephonyPort } from '../src/telephony/types.ts';
import type { VoiceBackendPort, VoiceSessionContext } from '../src/voice/types.ts';

// Fixed clock: before the event, 16:00 IST, so the calling window is open.
const NOW = new Date('2026-10-05T10:30:00.000Z');
const LIMITS = { maxCallSeconds: 30, silenceSeconds: 30, dialTimeoutSeconds: 30 };

const event: EventRecord = {
  id: 'launch-party-1234abcd',
  name: 'Launch party',
  startsAt: '2026-10-20T12:30:00.000Z',
  endsAt: '2026-10-20T16:30:00.000Z',
  timezone: 'Asia/Kolkata',
  brief: { about: '', where: '', notes: '' },
  sourceUrl: null,
  lastImport: null,
  createdAt: '2026-09-27T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
};

function guest(id: string, phone: string): GuestRecord {
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

function campaignFor(queue: string[]): CampaignRecord {
  return {
    id: 'pre-event-1234abcd',
    eventId: event.id,
    type: 'pre-event',
    name: 'Pre-event reminder',
    prompt: 'Remind {{guest.firstName}} about {{event.name}}.',
    useMasterPrompt: false,
    language: 'en',
    fields: [
      { key: 'will_attend', label: 'Will they attend?', kind: 'enum', options: ['yes', 'no'] },
    ],
    callingWindow: { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
    retryCap: 1,
    voiceBackendOrder: ['elevenlabs'],
    queue,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

const silentChannel: AudioChannel = { onAudio: () => {}, send: () => {}, clear: () => {} };

/** Telephony that answers whatever it is told to, and refuses listed numbers. */
class FakeCarrier implements TelephonyPort {
  readonly provider = 'fake-carrier';
  readonly dialed: string[] = [];
  readonly hungUp: string[] = [];
  readonly refuse = new Set<string>();
  /** Highest number of calls open at once. Overlapping dials show up here. */
  maxInFlight = 0;

  private readonly listeners: ((event: TelephonyEvent) => void)[] = [];
  private counter = 0;
  private inFlight = 0;

  onEvent(listener: (event: TelephonyEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: TelephonyEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async dial({ attemptId, to }: { attemptId: string; to: string }) {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.dialed.push(to);
    try {
      if (this.refuse.has(to)) throw new Error('dial refused by the carrier');
      this.emit({ attemptId, kind: 'ringing' });
      this.emit({ attemptId, kind: 'answered', channel: silentChannel });
      return { providerCallId: `pc-${++this.counter}` };
    } catch (error) {
      this.inFlight -= 1;
      throw error;
    }
  }

  /** The guest ending the call, which is how every fake call here finishes. */
  endCall(attemptId: string): void {
    if (this.inFlight > 0) this.inFlight -= 1;
    this.emit({ attemptId, kind: 'ended', reason: 'completed', detail: 'guest hung up' });
  }

  async hangup(attemptId: string): Promise<void> {
    this.hungUp.push(attemptId);
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

/** Voice backend that speaks a fixed exchange, then lets the guest hang up. */
class FakeVoice implements VoiceBackendPort {
  readonly backend = 'elevenlabs' as const;
  readonly prompts: string[] = [];

  constructor(private readonly afterTurns: (attemptId: string) => void) {}

  async hasCredits(): Promise<boolean> {
    return true;
  }

  async start(ctx: VoiceSessionContext) {
    this.prompts.push(ctx.prompt);
    const at = NOW.toISOString();
    ctx.onTranscript({ role: 'agent', text: 'Are you coming on the 20th?', at });
    ctx.onTranscript({ role: 'guest', text: 'Yes, I will be there.', at });

    setImmediate(() => this.afterTurns(ctx.attemptId));
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

describe('CallRunner', () => {
  let dataDir: string;
  let store: JsonStore;
  let telephony: FakeCarrier;
  let voice: FakeVoice;
  let extract: SinonStub;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'calling-agent-runner-'));
    store = new JsonStore(dataDir);
    telephony = new FakeCarrier();
    voice = new FakeVoice((attemptId) => telephony.endCall(attemptId));
    extract = sinon.stub().resolves({ fields: { will_attend: 'yes' }, openQuestions: [] });
    await store.putEvent(event);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function buildRunner(
    voiceBackend: VoiceBackendPort = voice,
    timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void },
  ): CallRunner {
    return new CallRunner({
      storage: store,
      telephony,
      voice: voiceBackend,
      extraction: { provider: 'fake-llm', extract },
      limits: LIMITS,
      now: () => NOW,
      log: () => {},
      timers,
    });
  }

  it('works the queue in order and stores an extracted result per guest', async () => {
    const guests = [guest('asha', '+919876543210'), guest('vikram', '+919876543211')];
    const campaign = campaignFor(guests.map((entry) => entry.id));
    await store.replaceGuests(event.id, guests);
    await store.putCampaign(campaign);

    const runner = buildRunner();
    const started = await runner.startRun(campaign, { kind: 'queue' });
    await waitFor(
      async () => (await store.getRun(event.id, started.id))?.status === 'completed',
      'the run to complete',
    );

    // Dialed in queue order, with numbers read from storage.
    expect(telephony.dialed).to.deep.equal(['+919876543210', '+919876543211']);

    const attempts = await store.listAttempts(event.id);
    expect(attempts).to.have.lengthOf(2);
    for (const attempt of attempts) {
      expect(attempt.status).to.equal('done');
      expect(attempt.outcome).to.equal('answered');
      expect(attempt.capturedFields).to.deep.equal({ will_attend: 'yes' });
      expect(attempt.voiceBackend).to.equal('elevenlabs');
      expect(attempt.transcript).to.have.lengthOf(2);
      expect(attempt.timeline.map((step) => step.kind)).to.include.members([
        'dialing',
        'answered',
        'backend_started',
        'call_ended',
        'extraction_done',
      ]);
    }

    // The prompt a call runs on carries the guest's own context.
    expect(voice.prompts[0]).to.contain('Guest asha').and.contain('Launch party');
    expect(extract.firstCall.args[0].transcript).to.have.lengthOf(2);

    const run = await store.getRun(event.id, started.id);
    expect(run?.attemptIds).to.have.lengthOf(2);
    expect(run?.currentAttemptId).to.equal(null);
  });

  it('skips a guest the guardrails refuse and stores a failed dial as failed', async () => {
    const asha = guest('asha', '+919876543210');
    const vikram = guest('vikram', '+919876543211');
    const campaign = campaignFor([asha.id, vikram.id]);
    await store.replaceGuests(event.id, [asha, vikram]);
    await store.putCampaign(campaign);

    // Asha is already at the retry cap, so she must not be dialed again.
    const earlier: AttemptRecord = {
      id: '20261001120000-aaaaaaaa',
      eventId: event.id,
      campaignId: campaign.id,
      guestId: asha.id,
      runId: null,
      status: 'done',
      outcome: 'no_answer',
      startedAt: '2026-10-01T12:00:00.000Z',
      endedAt: '2026-10-01T12:01:00.000Z',
      transcript: [],
      capturedFields: {},
      openQuestions: [],
      voiceBackend: null,
      fallbackUsed: false,
      providerCallId: null,
      voiceSessionId: null,
      timeline: [],
      error: null,
    };
    await store.putAttempt(earlier);
    telephony.refuse.add(vikram.phone);

    const runner = buildRunner();
    const started = await runner.startRun(campaign, { kind: 'queue' });
    await waitFor(
      async () => (await store.getRun(event.id, started.id))?.status === 'completed',
      'the run to complete',
    );

    expect(telephony.dialed).to.deep.equal([vikram.phone]);

    const run = await store.getRun(event.id, started.id);
    expect(run?.skipped).to.deep.equal([
      { guestId: asha.id, reason: 'retry cap reached (1/1)' },
    ]);

    const attempts = await store.listAttempts(event.id);
    const failed = attempts.find((attempt) => attempt.guestId === vikram.id);
    expect(failed?.outcome).to.equal('failed');
    expect(failed?.error).to.match(/dial refused by the carrier/);
    expect(failed?.capturedFields).to.deep.equal({ will_attend: 'unknown' });
    expect(extract.called).to.equal(false);
  });

  it('hangs up when the agent ends the conversation', async () => {
    const asha = guest('asha', '+919876543210');
    const campaign = campaignFor([asha.id]);
    await store.replaceGuests(event.id, [asha]);
    await store.putCampaign(campaign);

    const runner = buildRunner(new AgentEndsVoice());
    const started = await runner.startRun(campaign, { kind: 'queue' });
    await waitFor(
      async () => (await store.getRun(event.id, started.id))?.status === 'completed',
      'the run to complete',
    );

    const [attempt] = await store.listAttempts(event.id);
    expect(attempt?.outcome).to.equal('answered');
    expect(attempt?.error).to.equal(null);
    expect(attempt?.timeline.find((step) => step.kind === 'call_ended')?.detail).to.include(
      'agent ended the call: user asked to end',
    );
    expect(telephony.hungUp).to.have.lengthOf(1);
  });

  it('dials a scheduled run only after its start time', async () => {
    const asha = guest('asha', '+919876543210');
    const campaign = campaignFor([asha.id]);
    await store.replaceGuests(event.id, [asha]);
    await store.putCampaign(campaign);

    const timers = new ManualTimers();
    const runner = buildRunner(voice, timers);
    const start = new Date(NOW.getTime() + 60 * 60 * 1000);
    const scheduled = await runner.scheduleRun(campaign, start);

    expect(scheduled.status).to.equal('scheduled');
    expect(scheduled.scheduledFor).to.equal(start.toISOString());
    expect(telephony.dialed).to.deep.equal([]);

    timers.fireSoonest();
    await waitFor(
      async () => (await store.getRun(event.id, scheduled.id))?.status === 'completed',
      'the scheduled run to complete',
    );
    expect(telephony.dialed).to.deep.equal([asha.phone]);
  });

  it('cancels a scheduled run before anything is dialed', async () => {
    const asha = guest('asha', '+919876543210');
    const campaign = campaignFor([asha.id]);
    await store.replaceGuests(event.id, [asha]);
    await store.putCampaign(campaign);

    const timers = new ManualTimers();
    const runner = buildRunner(voice, timers);
    const scheduled = await runner.scheduleRun(campaign, new Date(NOW.getTime() + 60 * 60 * 1000));
    const stopped = await runner.stopRun(scheduled.id);

    expect(stopped?.status).to.equal('stopped');
    expect(timers.pending).to.have.lengthOf(0);
    expect(telephony.dialed).to.deep.equal([]);
    expect((await store.getRun(event.id, scheduled.id))?.status).to.equal('stopped');
  });

  it('refuses a start time outside the calling window', async () => {
    const asha = guest('asha', '+919876543210');
    const campaign = campaignFor([asha.id]);
    await store.replaceGuests(event.id, [asha]);
    await store.putCampaign(campaign);

    const timers = new ManualTimers();
    const runner = buildRunner(voice, timers);
    let refused = false;
    try {
      // 21:00 IST, after the 20:00 end of the window.
      await runner.scheduleRun(campaign, new Date('2026-10-05T15:30:00.000Z'));
    } catch (error) {
      refused = true;
      expect((error as Error).message).to.include('outside the calling window');
    }

    expect(refused).to.equal(true);
    expect(await store.listRuns(event.id)).to.have.lengthOf(0);
    expect(timers.pending).to.have.lengthOf(0);
  });

  it('will not dial a due schedule beside a call that is still starting', async () => {
    const asha = guest('asha', '+919876543210');
    const vikram = guest('vikram', '+919876543211');
    const queued = campaignFor([asha.id]);
    const single = { ...campaignFor([vikram.id]), id: 'single-call-1234abcd' };
    await store.replaceGuests(event.id, [asha, vikram]);
    await store.putCampaign(queued);
    await store.putCampaign(single);

    const timers = new ManualTimers();
    const runner = buildRunner(voice, timers);
    const scheduled = await runner.scheduleRun(queued, new Date(NOW.getTime() + 60 * 60 * 1000));

    let refused = false;
    try {
      await runner.startRun(queued, { kind: 'single', guestIds: [asha.id] });
    } catch (error) {
      refused = true;
      expect((error as Error).message).to.include('already scheduled');
    }
    expect(refused).to.equal(true);
    expect((await store.getRun(event.id, scheduled.id))?.status).to.equal('scheduled');

    let releaseGuest: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGuest = resolve;
    });
    let waitingForGuest = false;
    const readGuest = store.getGuest.bind(store);
    sinon.stub(store, 'getGuest').callsFake(async (eventId: string, guestId: string) => {
      if (guestId === vikram.id) {
        waitingForGuest = true;
        await gate;
      }
      return readGuest(eventId, guestId);
    });

    const pendingStart = runner.startRun(single, { kind: 'single', guestIds: [vikram.id] });
    await waitFor(async () => waitingForGuest, 'the guest lookup to start');
    timers.fireSoonest();
    await waitFor(async () => timers.pending.length === 1, 'the schedule to wait for the live call');

    expect(telephony.dialed).to.deep.equal([]);
    expect(timers.pending).to.have.lengthOf(1);
    expect((await store.getRun(event.id, scheduled.id))?.status).to.equal('scheduled');

    releaseGuest();
    const started = await pendingStart;
    await waitFor(
      async () => (await store.getRun(event.id, started.id))?.status === 'completed',
      'the one-guest call to finish',
    );
    expect(telephony.dialed).to.deep.equal([vikram.phone]);
    expect(telephony.maxInFlight).to.equal(1);

    timers.fireSoonest();
    await waitFor(
      async () => (await store.getRun(event.id, scheduled.id))?.status === 'completed',
      'the scheduled run to complete',
    );
    expect(telephony.dialed).to.deep.equal([vikram.phone, asha.phone]);
    expect(telephony.maxInFlight).to.equal(1);
  });
});

/** Timer the schedule tests fire by hand, so a start an hour ahead does not wait. */
class ManualTimers {
  readonly pending: { id: number; fn: () => void }[] = [];
  private next = 1;

  set(fn: () => void, _ms: number): number {
    const id = this.next++;
    this.pending.push({ id, fn });
    return id;
  }

  clear(handle: unknown): void {
    const index = this.pending.findIndex((entry) => entry.id === handle);
    if (index >= 0) this.pending.splice(index, 1);
  }

  /** Run the soonest callback. The caller waits on storage for the dial to finish. */
  fireSoonest(): void {
    const entry = this.pending.shift();
    if (!entry) throw new Error('no timer is waiting');
    entry.fn();
  }
}

/** Voice backend that closes the call itself instead of waiting for the guest. */
class AgentEndsVoice implements VoiceBackendPort {
  readonly backend = 'elevenlabs' as const;

  async hasCredits(): Promise<boolean> {
    return true;
  }

  async start(ctx: VoiceSessionContext) {
    const at = NOW.toISOString();
    ctx.onTranscript({ role: 'guest', text: 'Please cut the call.', at });
    ctx.onAgentEnd('agent ended the call: user asked to end');
    return { sessionId: `sess-${ctx.attemptId}`, close: async () => {} };
  }
}
