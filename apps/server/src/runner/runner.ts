/**
 * Sequential campaign runner. It works through a queue one guest at a time,
 * enforcing the runtime guardrails before every dial, and it is the only place
 * that turns call lifecycle events into stored attempts. Calling one guest on
 * demand is the same path with a queue of one (DESIGN, phase 2). Pipeline tests
 * reuse the dial and voice bridge but persist a separate record.
 */
import type { CallLimits } from '../config.ts';
import type { ExtractionPort } from '../extraction/types.ts';
import { allUnknown } from '../extraction/types.ts';
import { newAttemptId, newRunId, newTestCallId } from '../storage/ids.ts';
import type {
  AttemptEvent,
  AttemptEventKind,
  AttemptRecord,
  CallOutcome,
  CampaignRecord,
  CaptureField,
  EventRecord,
  GuestRecord,
  Language,
  RunKind,
  RunRecord,
  Storage,
  TestCallPromptSource,
  TestCallRecord,
  TranscriptTurn,
} from '../storage/types.ts';
import type {
  AudioChannel,
  CallEndReason,
  TelephonyEvent,
  TelephonyPort,
} from '../telephony/types.ts';
import type { VoiceBackendPort, VoiceSession } from '../voice/types.ts';
import { checkGuardrails, countAttemptsByGuest } from './guardrails.ts';
import { assemblePrompt } from './prompt.ts';
import { assembleTestPrompt } from './test-prompt.ts';

/** A second run or test call was asked for while one is still going. */
export class RunConflictError extends Error {
  constructor(readonly runId: string) {
    super(`a call is already in progress: ${runId}`);
    this.name = 'RunConflictError';
  }
}

/** A guardrail refused the guest before anything was dialed. */
export class GuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardrailError';
  }
}

export interface RunnerDeps {
  storage: Storage;
  telephony: TelephonyPort;
  voice: VoiceBackendPort;
  extraction: ExtractionPort;
  limits: CallLimits;
  now?: () => Date;
  log?: (message: string) => void;
}

/** What startTestCall needs after the API has resolved number and prompt source. */
export interface StartTestCallInput {
  eventId: string | null;
  to: string;
  promptSource: TestCallPromptSource;
  language: Language;
  fields: CaptureField[];
}

/** How one live call ended, before it is mapped to a stored outcome. */
interface CallResult {
  reason: CallEndReason;
  detail: string | null;
  machine: boolean;
  error: string | null;
}

/**
 * Shared call fields written as the dial proceeds. Guest attempts and test
 * calls both persist a copy of this snapshot.
 */
interface CallSnapshot {
  status: AttemptRecord['status'];
  outcome: CallOutcome | null;
  startedAt: string;
  endedAt: string | null;
  transcript: TranscriptTurn[];
  capturedFields: Record<string, string>;
  voiceBackend: AttemptRecord['voiceBackend'];
  fallbackUsed: boolean;
  providerCallId: string | null;
  voiceSessionId: string | null;
  timeline: AttemptEvent[];
  error: string | null;
}

/**
 * In-memory state for the single call that is up right now. The dial path and
 * the provider callbacks both go through `snapshot`, so neither can overwrite
 * what the other just recorded.
 */
interface LiveCall {
  attemptId: string;
  to: string;
  language: Language;
  fields: CaptureField[];
  snapshot: CallSnapshot;
  persist: (snapshot: CallSnapshot) => Promise<void>;
  buildPrompt: () => Promise<string>;
  session: VoiceSession | null;
  answered: boolean;
  guestSpoke: boolean;
  settled: boolean;
  timers: NodeJS.Timeout[];
  settle(result: CallResult): void;
}

export class CallRunner {
  private readonly deps: RunnerDeps;
  private activeRunId: string | null = null;
  private stopRequested = false;
  private live: LiveCall | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    deps.telephony.onEvent((event) => this.onTelephonyEvent(event));
  }

  get activeRun(): string | null {
    return this.activeRunId;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private log(message: string): void {
    (this.deps.log ?? ((line: string) => console.log(line)))(`[runner] ${message}`);
  }

  /** Serialize record writes, so transcript turns never interleave mid-file. */
  private persistLive(live: LiveCall): Promise<void> {
    const snapshot = live.snapshot;
    const write = this.writes.then(() => live.persist(snapshot));
    this.writes = write.catch(() => undefined);
    return write;
  }

  /**
   * Start a run. `guestIds` defaults to the saved campaign queue; a single-guest
   * call passes exactly one id, which must already be in that queue. The work
   * continues in the background, so the organizer's request returns at once.
   */
  async startRun(
    campaign: CampaignRecord,
    options: { kind: RunKind; guestIds?: string[] },
  ): Promise<RunRecord> {
    if (this.activeRunId) throw new RunConflictError(this.activeRunId);

    const guestIds = options.guestIds ?? [...campaign.queue];
    if (guestIds.length === 0) throw new GuardrailError('the campaign queue is empty');

    // A single guest is refused up front, so the organizer sees the reason at
    // once rather than finding a skipped entry on a finished run. Queue runs
    // are checked per guest instead, because a long queue goes stale mid-run.
    if (options.kind === 'single') {
      await this.assertGuestCallable(campaign, guestIds[0]!);
    }

    const startedAt = this.now().toISOString();
    const run: RunRecord = {
      id: newRunId(startedAt),
      eventId: campaign.eventId,
      campaignId: campaign.id,
      kind: options.kind,
      status: 'running',
      guestIds,
      currentGuestId: null,
      currentAttemptId: null,
      attemptIds: [],
      skipped: [],
      startedAt,
      endedAt: null,
      error: null,
    };

    this.activeRunId = run.id;
    this.stopRequested = false;
    await this.deps.storage.putRun(run);

    void this.execute(run).catch(async (error: unknown) => {
      this.log(`run ${run.id} failed: ${String(error)}`);
      await this.finishRun(run, 'failed', error instanceof Error ? error.message : String(error));
    });

    return run;
  }

  /**
   * Place one pipeline test through the same dial and voice path as a guest
   * call. Skips guest guardrails. Takes the single live-call lock.
   */
  async startTestCall(input: StartTestCallInput): Promise<TestCallRecord> {
    if (this.activeRunId) throw new RunConflictError(this.activeRunId);

    const startedAt = this.now().toISOString();
    const call: TestCallRecord = {
      id: newTestCallId(startedAt),
      eventId: input.eventId,
      to: input.to,
      promptSource: input.promptSource,
      language: input.language,
      fields: input.fields,
      status: 'dialing',
      outcome: null,
      startedAt,
      endedAt: null,
      transcript: [],
      capturedFields: {},
      voiceBackend: null,
      fallbackUsed: false,
      providerCallId: null,
      voiceSessionId: null,
      timeline: [],
      error: null,
    };

    this.activeRunId = call.id;
    this.stopRequested = false;
    await this.deps.storage.putTestCall(call);

    void this.executeTestCall(call).catch(async (error: unknown) => {
      this.log(`test call ${call.id} failed: ${String(error)}`);
      const latest = (await this.deps.storage.getTestCall(call.id)) ?? call;
      await this.deps.storage.putTestCall({
        ...latest,
        status: 'done',
        outcome: 'failed',
        endedAt: this.now().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      this.activeRunId = null;
    });

    return call;
  }

  /** Stop the active run: no further dials, and the live call is hung up. */
  async stopRun(runId: string): Promise<RunRecord | null> {
    const run = await this.deps.storage.findRun(runId);
    if (!run) return null;
    if (run.status !== 'running' && run.status !== 'stopping') return run;

    this.stopRequested = true;
    const stopping: RunRecord = { ...run, status: 'stopping' };
    await this.deps.storage.putRun(stopping);

    if (this.live) await this.deps.telephony.hangup(this.live.attemptId);
    return stopping;
  }

  /** Hang up a live pipeline test. A finished test is returned unchanged. */
  async stopTestCall(id: string): Promise<TestCallRecord | null> {
    const call = await this.deps.storage.getTestCall(id);
    if (!call) return null;
    if (this.live?.attemptId === id) await this.deps.telephony.hangup(id);
    return (await this.deps.storage.getTestCall(id)) ?? call;
  }

  /**
   * A restart kills every live call, so nothing may still look in flight. Runs,
   * attempts, and test calls left unfinished are closed as interrupted.
   */
  async reconcileOnStartup(): Promise<{ attempts: number; runs: number; testCalls: number }> {
    let attempts = 0;
    let runs = 0;
    let testCalls = 0;
    const at = this.now().toISOString();

    for (const eventId of await this.deps.storage.listEventIds()) {
      for (const attempt of await this.deps.storage.listAttempts(eventId)) {
        if (attempt.status === 'done') continue;
        await this.deps.storage.putAttempt({
          ...attempt,
          status: 'done',
          outcome: 'failed',
          endedAt: attempt.endedAt ?? at,
          error: attempt.error ?? 'interrupted by a server restart',
          timeline: [
            ...attempt.timeline,
            { at, kind: 'interrupted', detail: 'the server restarted while this call was live' },
          ],
        });
        attempts += 1;
      }

      for (const run of await this.deps.storage.listRuns(eventId)) {
        if (run.status !== 'running' && run.status !== 'stopping') continue;
        await this.deps.storage.putRun({
          ...run,
          status: 'interrupted',
          currentGuestId: null,
          currentAttemptId: null,
          endedAt: run.endedAt ?? at,
          error: run.error ?? 'interrupted by a server restart',
        });
        runs += 1;
      }
    }

    for (const call of await this.deps.storage.listAllTestCalls()) {
      if (call.status === 'done') continue;
      await this.deps.storage.putTestCall({
        ...call,
        status: 'done',
        outcome: 'failed',
        endedAt: call.endedAt ?? at,
        error: call.error ?? 'interrupted by a server restart',
        timeline: [
          ...call.timeline,
          { at, kind: 'interrupted', detail: 'the server restarted while this call was live' },
        ],
      });
      testCalls += 1;
    }

    if (attempts > 0 || runs > 0 || testCalls > 0) {
      this.log(
        `marked ${runs} run(s), ${attempts} attempt(s), and ${testCalls} test call(s) as interrupted`,
      );
    }
    return { attempts, runs, testCalls };
  }

  private async assertGuestCallable(campaign: CampaignRecord, guestId: string): Promise<void> {
    const event = await this.deps.storage.getEvent(campaign.eventId);
    if (!event) throw new GuardrailError(`event not found: ${campaign.eventId}`);

    const guest = await this.deps.storage.getGuest(campaign.eventId, guestId);
    if (!guest) throw new GuardrailError(`guest not found on this event: ${guestId}`);

    const attempts = await this.deps.storage.listAttempts(campaign.eventId);
    const guard = checkGuardrails(guest, {
      event,
      campaign,
      attemptsByGuest: countAttemptsByGuest(attempts, campaign.id),
      now: this.now(),
    });
    if (!guard.ok) throw new GuardrailError(guard.reason);
  }

  /**
   * Merge into the stored run rather than overwriting it, because a stop
   * request lands on the same record while the loop is mid-call.
   */
  private async patchRun(run: RunRecord, patch: Partial<RunRecord>): Promise<RunRecord> {
    const latest = (await this.deps.storage.getRun(run.eventId, run.id)) ?? run;
    const merged: RunRecord = { ...latest, ...patch };
    await this.deps.storage.putRun(merged);
    return merged;
  }

  /** The run loop: one guest at a time, re-reading state before every dial. */
  private async execute(run: RunRecord): Promise<void> {
    let current = run;

    try {
      for (const guestId of run.guestIds) {
        if (this.stopRequested) break;

        const event = await this.deps.storage.getEvent(run.eventId);
        const campaign = await this.deps.storage.getCampaign(run.eventId, run.campaignId);
        if (!event || !campaign) throw new Error('the event or campaign was removed mid-run');

        const guest = await this.deps.storage.getGuest(run.eventId, guestId);
        const attempts = await this.deps.storage.listAttempts(run.eventId);
        const guard = guest
          ? checkGuardrails(guest, {
              event,
              campaign,
              attemptsByGuest: countAttemptsByGuest(attempts, campaign.id),
              now: this.now(),
            })
          : { ok: false as const, reason: 'guest is no longer on the event' };

        if (!guard.ok) {
          this.log(`skipping ${guestId}: ${guard.reason}`);
          current = await this.patchRun(current, {
            skipped: [...current.skipped, { guestId, reason: guard.reason }],
          });
          continue;
        }

        const attempt = await this.placeCall(event, campaign, guest!, current.id);
        current = await this.patchRun(current, {
          attemptIds: [...current.attemptIds, attempt.id],
          currentGuestId: null,
          currentAttemptId: null,
        });
      }

      await this.finishRun(current, this.stopRequested ? 'stopped' : 'completed', null);
    } finally {
      this.activeRunId = null;
      this.stopRequested = false;
    }
  }

  /** Dial one test call, then release the live-call lock. */
  private async executeTestCall(call: TestCallRecord): Promise<void> {
    try {
      await this.placeTestCall(call);
    } finally {
      this.activeRunId = null;
      this.stopRequested = false;
    }
  }

  private async finishRun(
    run: RunRecord,
    status: RunRecord['status'],
    error: string | null,
  ): Promise<void> {
    await this.patchRun(run, {
      status,
      currentGuestId: null,
      currentAttemptId: null,
      endedAt: this.now().toISOString(),
      error,
    });
    this.activeRunId = null;
  }

  /**
   * One guest call end to end: create the attempt, then share the dial and
   * voice bridge with pipeline tests.
   */
  private async placeCall(
    event: EventRecord,
    campaign: CampaignRecord,
    guest: GuestRecord,
    runId: string,
  ): Promise<AttemptRecord> {
    const startedAt = this.now().toISOString();
    const attemptId = newAttemptId(startedAt);
    const identity = {
      id: attemptId,
      eventId: event.id,
      campaignId: campaign.id,
      guestId: guest.id,
      runId,
    };

    const live = this.openLiveCall({
      attemptId,
      to: guest.phone,
      language: campaign.language,
      fields: campaign.fields,
      startedAt,
      createdDetail: `queued for ${guest.name}`,
      persist: async (snapshot) => {
        await this.deps.storage.putAttempt({ ...identity, ...snapshot });
      },
      buildPrompt: async () => {
        const currentCampaign = await this.deps.storage.getCampaign(event.id, campaign.id);
        const currentEvent = await this.deps.storage.getEvent(event.id);
        const currentGuest = await this.deps.storage.getGuest(event.id, guest.id);
        if (!currentCampaign || !currentEvent || !currentGuest) {
          throw new Error('the event, campaign, or guest was removed mid-call');
        }
        const settings = await this.deps.storage.getSettings();
        return assemblePrompt({
          event: currentEvent,
          campaign: currentCampaign,
          guest: currentGuest,
          settings,
        });
      },
    });

    const run = await this.deps.storage.getRun(event.id, runId);
    if (run) {
      await this.patchRun(run, { currentGuestId: guest.id, currentAttemptId: attemptId });
    }

    const snapshot = await this.runLiveCall(live);
    this.log(endedLine(`attempt ${attemptId} for ${guest.name}`, snapshot));
    return { ...identity, ...snapshot };
  }

  /** One pipeline test: persist a test record, then share the dial and voice bridge. */
  private async placeTestCall(call: TestCallRecord): Promise<TestCallRecord> {
    const live = this.openLiveCall({
      attemptId: call.id,
      to: call.to,
      language: call.language,
      fields: call.fields,
      startedAt: call.startedAt,
      createdDetail: `pipeline test to ${call.to}`,
      persist: async (snapshot) => {
        await this.deps.storage.putTestCall({ ...call, ...snapshot });
      },
      buildPrompt: async () => {
        const settings = await this.deps.storage.getSettings();
        let campaign: CampaignRecord | null = null;
        let event: EventRecord | null = call.eventId
          ? await this.deps.storage.getEvent(call.eventId)
          : null;
        if (call.promptSource.kind === 'campaign') {
          campaign = await this.deps.storage.findCampaign(call.promptSource.campaignId);
          if (!event && campaign) event = await this.deps.storage.getEvent(campaign.eventId);
        }
        return assembleTestPrompt({
          promptSource: call.promptSource,
          event,
          campaign,
          settings,
          language: call.language,
          fields: call.fields,
        });
      },
    });

    const snapshot = await this.runLiveCall(live);
    this.log(endedLine(`test call ${call.id}`, snapshot));
    return { ...call, ...snapshot };
  }

  /** Build the in-memory live-call shell before dialing. */
  private openLiveCall(input: {
    attemptId: string;
    to: string;
    language: Language;
    fields: CaptureField[];
    startedAt: string;
    createdDetail: string;
    persist: (snapshot: CallSnapshot) => Promise<void>;
    buildPrompt: () => Promise<string>;
  }): LiveCall {
    return {
      attemptId: input.attemptId,
      to: input.to,
      language: input.language,
      fields: input.fields,
      snapshot: {
        status: 'dialing',
        outcome: null,
        startedAt: input.startedAt,
        endedAt: null,
        transcript: [],
        capturedFields: {},
        voiceBackend: null,
        fallbackUsed: false,
        providerCallId: null,
        voiceSessionId: null,
        timeline: [{ at: input.startedAt, kind: 'created', detail: input.createdDetail }],
        error: null,
      },
      persist: input.persist,
      buildPrompt: input.buildPrompt,
      session: null,
      answered: false,
      guestSpoke: false,
      settled: false,
      timers: [],
      settle: () => {},
    };
  }

  /**
   * Dial, wait for the call to end, extract fields when the person answered.
   * Guest attempts and test calls both go through here.
   */
  private async runLiveCall(live: LiveCall): Promise<CallSnapshot> {
    this.live = live;
    await this.persistLive(live);

    const settled = new Promise<CallResult>((resolve) => {
      live.settle = (result) => {
        if (live.settled) return;
        live.settled = true;
        for (const timer of live.timers) clearTimeout(timer);
        resolve(result);
      };
    });

    try {
      this.advance(live, 'dialing', `dialing ${live.to}`);
      const { providerCallId } = await this.deps.telephony.dial({
        attemptId: live.attemptId,
        to: live.to,
      });
      live.snapshot = { ...live.snapshot, providerCallId };
      await this.persistLive(live);

      live.timers.push(
        setTimeout(() => {
          if (live.answered || live.settled) return;
          void this.deps.telephony.hangup(live.attemptId);
          live.settle({
            reason: 'no_answer',
            detail: 'no answer before the dial timeout',
            machine: false,
            error: null,
          });
        }, this.deps.limits.dialTimeoutSeconds * 1000),
      );
    } catch (error) {
      live.settle({
        reason: 'failed',
        detail: null,
        machine: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const result = await settled;
    this.live = null;
    await live.session?.close().catch(() => undefined);

    const outcome = mapOutcome(result, live);
    let snapshot = this.record(
      { ...live.snapshot, endedAt: this.now().toISOString(), outcome },
      'call_ended',
      [outcome, result.detail].filter(Boolean).join(': '),
    );
    if (result.error) snapshot.error = result.error;

    if (outcome === 'answered' && live.fields.length > 0) {
      snapshot = this.record(
        { ...snapshot, status: 'extracting' },
        'extraction_started',
        this.deps.extraction.provider,
      );
      live.snapshot = snapshot;
      await this.persistLive(live);
      snapshot = await this.runExtraction(snapshot, live.fields, live.language);
    } else {
      snapshot.capturedFields = allUnknown(live.fields);
    }

    snapshot.status = 'done';
    live.snapshot = snapshot;
    await this.persistLive(live);
    return snapshot;
  }

  /** Append a lifecycle step to the live call and persist it in one move. */
  private advance(
    live: LiveCall,
    kind: AttemptEventKind,
    detail: string | null,
    patch: Partial<CallSnapshot> = {},
  ): void {
    live.snapshot = this.record({ ...live.snapshot, ...patch }, kind, detail);
    void this.persistLive(live);
  }

  /**
   * Extraction never loses a call: a failure keeps the transcript, leaves the
   * fields unknown, and records the error so it can be re-run later.
   */
  private async runExtraction(
    snapshot: CallSnapshot,
    fields: CaptureField[],
    language: Language,
  ): Promise<CallSnapshot> {
    try {
      const captured = await this.deps.extraction.extract({
        fields,
        transcript: snapshot.transcript,
        language,
      });
      return this.record(
        { ...snapshot, capturedFields: captured },
        'extraction_done',
        Object.keys(captured).join(', ') || null,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.record(
        {
          ...snapshot,
          capturedFields: allUnknown(fields),
          error: snapshot.error ?? `extraction failed: ${message}`,
        },
        'extraction_failed',
        message,
      );
    }
  }

  private record(
    snapshot: CallSnapshot,
    kind: AttemptEventKind,
    detail: string | null,
  ): CallSnapshot {
    const event: AttemptEvent = { at: this.now().toISOString(), kind, detail: detail || null };
    return { ...snapshot, timeline: [...snapshot.timeline, event] };
  }

  /** Route a provider event to the live call. Anything else is stale, so ignored. */
  private onTelephonyEvent(event: TelephonyEvent): void {
    const live = this.live;
    if (!live || live.attemptId !== event.attemptId || live.settled) return;

    switch (event.kind) {
      case 'ringing':
        this.advance(live, 'ringing', null);
        break;

      case 'machine_detected':
        this.advance(live, 'machine_detected', 'no message was left');
        void this.deps.telephony.hangup(live.attemptId);
        live.settle({
          reason: 'completed',
          detail: 'answering machine detected',
          machine: true,
          error: null,
        });
        break;

      case 'answered':
        live.answered = true;
        this.advance(live, 'answered', null, { status: 'in_call' });
        void this.startVoice(live, event.channel);
        break;

      case 'ended':
        live.settle({
          reason: event.reason,
          detail: event.detail ?? null,
          machine: false,
          error: null,
        });
        break;
    }
  }

  /** Bridge the answered call to the voice backend and arm the call guardrails. */
  private async startVoice(live: LiveCall, channel: AudioChannel): Promise<void> {
    let lastGuestTurnAt = Date.now();
    // Annotated because it re-arms itself: the guest may simply be slow, and
    // only a full quiet period should end the call.
    const armSilence = (): NodeJS.Timeout => {
      const timer = setTimeout(() => {
        if (live.settled) return;
        if (Date.now() - lastGuestTurnAt < this.deps.limits.silenceSeconds * 1000) {
          live.timers.push(armSilence());
          return;
        }
        void this.deps.telephony.hangup(live.attemptId);
        live.settle({
          reason: 'completed',
          detail: `no guest speech for ${this.deps.limits.silenceSeconds}s`,
          machine: false,
          error: null,
        });
      }, this.deps.limits.silenceSeconds * 1000);
      return timer;
    };

    let prompt: string;
    try {
      prompt = await live.buildPrompt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.deps.telephony.hangup(live.attemptId);
      live.settle({
        reason: 'failed',
        detail: 'could not build the prompt',
        machine: false,
        error: message,
      });
      return;
    }

    try {
      const session = await this.deps.voice.start({
        attemptId: live.attemptId,
        prompt,
        language: live.language,
        channel,
        onTranscript: (turn: TranscriptTurn) => {
          if (turn.role === 'guest') {
            live.guestSpoke = true;
            lastGuestTurnAt = Date.now();
          }
          live.snapshot = {
            ...live.snapshot,
            transcript: [...live.snapshot.transcript, turn],
          };
          void this.persistLive(live);
        },
        onAgentEnd: (detail: string) => {
          if (live.settled) return;
          // Settle before hangup so a synchronous ended event keeps this reason.
          live.settle({
            reason: 'completed',
            detail,
            machine: false,
            error: null,
          });
          void this.deps.telephony.hangup(live.attemptId);
        },
        onError: (error: Error) => {
          if (live.settled) return;
          void this.deps.telephony.hangup(live.attemptId);
          live.settle({
            reason: 'failed',
            detail: 'voice backend failed mid-call',
            machine: false,
            error: `${this.deps.voice.backend}: ${error.message}`,
          });
        },
      });

      if (live.settled) {
        await session.close().catch(() => undefined);
        return;
      }

      live.session = session;
      this.advance(live, 'backend_started', this.deps.voice.backend, {
        voiceBackend: this.deps.voice.backend,
        voiceSessionId: session.sessionId,
      });

      live.timers.push(
        setTimeout(() => {
          if (live.settled) return;
          void this.deps.telephony.hangup(live.attemptId);
          live.settle({
            reason: 'completed',
            detail: `maximum call length of ${this.deps.limits.maxCallSeconds}s reached`,
            machine: false,
            error: null,
          });
        }, this.deps.limits.maxCallSeconds * 1000),
      );
      live.timers.push(armSilence());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.deps.telephony.hangup(live.attemptId);
      live.settle({
        reason: 'failed',
        detail: 'the voice backend would not start',
        machine: false,
        error: `${this.deps.voice.backend}: ${message}`,
      });
    }
  }
}

/** One log line for a finished attempt or test call, including the error if any. */
function endedLine(label: string, snapshot: CallSnapshot): string {
  const error = snapshot.error ? `: ${snapshot.error}` : '';
  return `${label} ended as ${snapshot.outcome}${error}`;
}

/** Neutral end reason plus what happened on the call, as a stored outcome. */
function mapOutcome(
  result: CallResult,
  state: { answered: boolean; guestSpoke: boolean },
): CallOutcome {
  if (result.machine) return 'voicemail';
  if (result.error) return 'failed';

  switch (result.reason) {
    case 'completed':
      if (!state.answered) return 'failed';
      return state.guestSpoke ? 'answered' : 'hung_up';
    case 'busy':
    case 'rejected':
      return 'declined';
    case 'no_answer':
      return 'no_answer';
    case 'failed':
      return 'failed';
  }
}
