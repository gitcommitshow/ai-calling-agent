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
import { newAttemptId, newQuestionId, newRunId, newTestCallId } from '../storage/ids.ts';
import { emptyEventBrief } from '../storage/types.ts';
import type {
  AttemptEvent,
  AttemptEventKind,
  AttemptRecord,
  CallOutcome,
  CampaignRecord,
  CaptureField,
  EventBrief,
  EventRecord,
  GuestRecord,
  Language,
  OpenQuestion,
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
import {
  callingWindowRefusal,
  checkGuardrails,
  countAttemptsByGuest,
  isWithinCallingWindow,
  scheduleBlockReason,
} from './guardrails.ts';
import { assemblePrompt } from './prompt.ts';
import { assembleTestPrompt } from './test-prompt.ts';

/** A second run or test call was asked for while one is still going. */
export class RunConflictError extends Error {
  constructor(
    readonly runId: string,
    message?: string,
  ) {
    super(message ?? `a call is already in progress: ${runId}`);
    this.name = 'RunConflictError';
  }
}

/** How far ahead a start may be set, and how long a down server may still honor one. */
const SCHEDULE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;
const SCHEDULE_GRACE_MS = 60 * 1000;
/** Wait this long, then try again, when the start time arrives during another call. */
const SCHEDULE_RETRY_MS = 1000;

/** A guardrail refused the guest before anything was dialed. */
export class GuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardrailError';
  }
}

/** Test hook for the scheduled-start timer. Production uses the real clock. */
export interface RunnerTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface RunnerDeps {
  storage: Storage;
  telephony: TelephonyPort;
  voice: VoiceBackendPort;
  extraction: ExtractionPort;
  limits: CallLimits;
  /** From STRICT_CALLING_HOURS. Outside hours is refused even after a confirmation. */
  strictCallingHours?: boolean;
  now?: () => Date;
  log?: (message: string) => void;
  timers?: RunnerTimers;
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
  openQuestions: OpenQuestion[];
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
  /** Guest calls record unanswered questions. Pipeline tests do not. */
  captureQuestions: boolean;
  brief: EventBrief;
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
  private readonly setTimer: RunnerTimers['set'];
  private readonly clearTimer: RunnerTimers['clear'];
  private activeRunId: string | null = null;
  private stopRequested = false;
  private live: LiveCall | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  /** Serializes schedule create, cancel, and fire so they cannot pass each other. */
  private scheduleQueue: Promise<unknown> = Promise.resolve();
  private readonly scheduledTimers = new Map<string, unknown>();

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    this.setTimer = deps.timers?.set ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      deps.timers?.clear ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    deps.telephony.onEvent((event) => this.onTelephonyEvent(event));
  }

  get activeRun(): string | null {
    return this.activeRunId;
  }

  /** Drop the live-call lock when this run still holds it. */
  private releaseLock(runId: string): void {
    if (this.activeRunId !== runId) return;
    this.activeRunId = null;
    this.stopRequested = false;
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
    options: {
      kind: RunKind;
      guestIds?: string[];
      waiveRetryCap?: boolean;
      waiveCallingWindow?: boolean;
    },
  ): Promise<RunRecord> {
    if (this.activeRunId) throw new RunConflictError(this.activeRunId);

    const guestIds = options.guestIds ?? [...campaign.queue];
    if (guestIds.length === 0) throw new GuardrailError('the campaign queue is empty');
    const waiveRetryCap = options.waiveRetryCap === true;
    const waiveCallingWindow = options.waiveCallingWindow === true;

    // Refuse the whole start outside calling hours unless the organizer
    // confirmed. Queue runs used to skip every guest quietly after start.
    this.assertCallingWindow(campaign, waiveCallingWindow);

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
      waiveRetryCap,
      waiveCallingWindow,
      scheduledFor: null,
      startedAt,
      endedAt: null,
      error: null,
    };

    // Claim before any await. A due schedule checks this same lock and must
    // not dial while guest lookup is still in flight.
    this.activeRunId = run.id;
    this.stopRequested = false;
    try {
      await this.enqueueSchedule(async () => {
        const scheduled = await this.findScheduledRun();
        if (scheduled && scheduled.campaignId === campaign.id) {
          throw new RunConflictError(
            scheduled.id,
            `a run is already scheduled (${scheduled.id}). Cancel it before starting another.`,
          );
        }
      });

      // A single guest is refused up front, so the organizer sees the reason at
      // once rather than finding a skipped entry on a finished run. Queue runs
      // are checked per guest instead, because a long queue goes stale mid-run.
      if (options.kind === 'single') {
        await this.assertGuestCallable(campaign, guestIds[0]!, {
          waiveRetryCap,
          waiveCallingWindow,
        });
      }
      await this.deps.storage.putRun(run);
    } catch (error) {
      this.releaseLock(run.id);
      throw error;
    }

    void this.execute(run).catch(async (error: unknown) => {
      this.log(`run ${run.id} failed: ${String(error)}`);
      await this.finishRun(run, 'failed', error instanceof Error ? error.message : String(error));
    });

    return run;
  }

  /**
   * Remember a queue run for a later start. Nothing is dialed yet. Stop cancels
   * it. The saved queue is read again when the start time arrives, so the
   * organizer can still change who is called.
   */
  async scheduleRun(
    campaign: CampaignRecord,
    startsAt: Date,
    options: { waiveCallingWindow?: boolean } = {},
  ): Promise<RunRecord> {
    const at = startsAt.getTime();
    if (Number.isNaN(at)) throw new GuardrailError('choose a valid start time');
    const now = this.now().getTime();
    if (at <= now) throw new GuardrailError('choose a start time in the future');
    if (at - now > SCHEDULE_LIMIT_MS) {
      throw new GuardrailError('choose a start time within the next 14 days');
    }
    if (campaign.queue.length === 0) throw new GuardrailError('the campaign queue is empty');
    const waiveCallingWindow = options.waiveCallingWindow === true;

    return this.enqueueSchedule(async () => {
      const existing = await this.findScheduledRun();
      if (existing) {
        throw new RunConflictError(
          existing.id,
          `a run is already scheduled (${existing.id}). Cancel it before scheduling another.`,
        );
      }

      const event = await this.deps.storage.getEvent(campaign.eventId);
      if (!event) throw new GuardrailError(`event not found: ${campaign.eventId}`);
      const blocked = scheduleBlockReason(event, campaign, startsAt, {
        waiveCallingWindow,
        strictCallingHours: this.deps.strictCallingHours === true,
      });
      if (blocked) throw new GuardrailError(blocked);

      const createdAt = this.now().toISOString();
      const run: RunRecord = {
        id: newRunId(createdAt),
        eventId: campaign.eventId,
        campaignId: campaign.id,
        kind: 'queue',
        status: 'scheduled',
        guestIds: [...campaign.queue],
        currentGuestId: null,
        currentAttemptId: null,
        attemptIds: [],
        skipped: [],
        waiveRetryCap: false,
        waiveCallingWindow,
        scheduledFor: startsAt.toISOString(),
        startedAt: createdAt,
        endedAt: null,
        error: null,
      };
      await this.deps.storage.putRun(run);
      this.arm(run.id, at - this.now().getTime());
      return run;
    });
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
    try {
      await this.deps.storage.putTestCall(call);
    } catch (error) {
      this.releaseLock(call.id);
      throw error;
    }

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
    });

    return call;
  }

  /** Stop the active run, or cancel a start that has not dialed yet. */
  async stopRun(runId: string): Promise<RunRecord | null> {
    const run = await this.deps.storage.findRun(runId);
    if (!run) return null;
    if (run.status === 'scheduled') return this.enqueueSchedule(() => this.cancelScheduled(runId));
    return this.stopActive(run);
  }

  /** No further dials, and the live call is hung up. */
  private async stopActive(run: RunRecord): Promise<RunRecord> {
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

  /**
   * Put scheduled runs back on the clock after a restart. A start that already
   * passed, beyond a short grace, is cancelled so a late boot cannot dial hours
   * after the organizer expected.
   */
  async restoreSchedules(): Promise<number> {
    let restored = 0;
    for (const eventId of await this.deps.storage.listEventIds()) {
      for (const run of await this.deps.storage.listRuns(eventId)) {
        if (run.status !== 'scheduled' || !run.scheduledFor) continue;
        const delay = new Date(run.scheduledFor).getTime() - this.now().getTime();
        if (delay < -SCHEDULE_GRACE_MS) {
          await this.deps.storage.putRun({
            ...run,
            status: 'stopped',
            endedAt: this.now().toISOString(),
            error: 'the scheduled start passed while the server was down',
          });
          continue;
        }
        this.arm(run.id, Math.max(0, delay));
        restored += 1;
      }
    }
    if (restored > 0) this.log(`restored ${restored} scheduled run(s)`);
    return restored;
  }

  /** Run schedule changes one at a time so a cancel cannot lose to the timer. */
  private enqueueSchedule<T>(work: () => Promise<T>): Promise<T> {
    const result = this.scheduleQueue.then(work, work);
    this.scheduleQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** The one run that is waiting for its start time, if any. */
  private async findScheduledRun(): Promise<RunRecord | null> {
    for (const eventId of await this.deps.storage.listEventIds()) {
      for (const run of await this.deps.storage.listRuns(eventId)) {
        if (run.status === 'scheduled') return run;
      }
    }
    return null;
  }

  /** Call `onScheduleDue` once, replacing any timer already waiting for this run. */
  private arm(runId: string, delayMs: number): void {
    this.clearTimerFor(runId);
    const handle = this.setTimer(() => {
      void this.onScheduleDue(runId);
    }, delayMs);
    this.scheduledTimers.set(runId, handle);
  }

  /** Drop a pending start timer. A timer that already fired is a no-op. */
  private clearTimerFor(runId: string): void {
    const handle = this.scheduledTimers.get(runId);
    if (handle === undefined) return;
    this.clearTimer(handle);
    this.scheduledTimers.delete(runId);
  }

  /** Timer callback. A failure is stored on the run so it does not sit scheduled forever. */
  private async onScheduleDue(runId: string): Promise<void> {
    try {
      await this.enqueueSchedule(() => this.beginScheduled(runId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`scheduled run ${runId} failed to start: ${message}`);
      this.releaseLock(runId);
      const latest = await this.deps.storage.findRun(runId).catch(() => null);
      if (latest?.status !== 'scheduled') return;
      await this.deps.storage
        .putRun({
          ...latest,
          status: 'failed',
          endedAt: this.now().toISOString(),
          error: message,
        })
        .catch(() => undefined);
    }
  }

  /**
   * Turn a due schedule into a live run. If another call still holds the lock,
   * wait and try again. The queue is whatever is saved at this moment.
   */
  private async beginScheduled(runId: string): Promise<void> {
    this.clearTimerFor(runId);
    const run = await this.deps.storage.findRun(runId);
    if (!run || run.status !== 'scheduled') return;

    if (this.activeRunId) {
      this.arm(runId, SCHEDULE_RETRY_MS);
      return;
    }

    // Claim the lock before the next await so an immediate start cannot slip in.
    this.activeRunId = runId;
    this.stopRequested = false;
    try {
      const campaign = await this.deps.storage.getCampaign(run.eventId, run.campaignId);
      if (!campaign || campaign.queue.length === 0) {
        this.releaseLock(runId);
        await this.deps.storage.putRun({
          ...run,
          status: 'failed',
          guestIds: campaign ? [] : run.guestIds,
          endedAt: this.now().toISOString(),
          error: campaign
            ? 'the campaign queue was empty at the scheduled start'
            : 'the campaign was removed before the scheduled start',
        });
        return;
      }

      const running: RunRecord = {
        ...run,
        status: 'running',
        guestIds: [...campaign.queue],
        // Dialing starts now, so this run sorts ahead of calls that finished
        // while it was waiting.
        startedAt: this.now().toISOString(),
      };
      await this.deps.storage.putRun(running);

      void this.execute(running).catch(async (error: unknown) => {
        this.log(`run ${running.id} failed: ${String(error)}`);
        await this.finishRun(
          running,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
      });
    } catch (error) {
      this.releaseLock(runId);
      throw error;
    }
  }

  /** Drop a schedule that has not started. If it already started, stop that run. */
  private async cancelScheduled(runId: string): Promise<RunRecord | null> {
    const run = await this.deps.storage.findRun(runId);
    if (!run) return null;
    if (run.status !== 'scheduled') return this.stopActive(run);

    this.clearTimerFor(runId);
    const stopped: RunRecord = {
      ...run,
      status: 'stopped',
      endedAt: this.now().toISOString(),
      error: null,
    };
    await this.deps.storage.putRun(stopped);
    return stopped;
  }

  private async assertGuestCallable(
    campaign: CampaignRecord,
    guestId: string,
    options: { waiveRetryCap: boolean; waiveCallingWindow: boolean },
  ): Promise<void> {
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
      waiveRetryCap: options.waiveRetryCap,
      waiveCallingWindow: options.waiveCallingWindow,
      strictCallingHours: this.deps.strictCallingHours === true,
    });
    if (!guard.ok) throw new GuardrailError(guard.reason);
  }

  /**
   * Block a start that is outside daily calling hours unless the organizer
   * already confirmed the override. Strict mode ignores that confirmation.
   */
  private assertCallingWindow(campaign: CampaignRecord, waiveCallingWindow: boolean): void {
    const strictCallingHours = this.deps.strictCallingHours === true;
    if (!strictCallingHours && waiveCallingWindow) return;
    if (isWithinCallingWindow(this.now(), campaign.callingWindow)) return;
    throw new GuardrailError(
      callingWindowRefusal(campaign.callingWindow, { strictCallingHours, kind: 'start' }),
    );
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
              waiveRetryCap: run.waiveRetryCap === true,
              waiveCallingWindow: run.waiveCallingWindow === true,
              strictCallingHours: this.deps.strictCallingHours === true,
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
      this.releaseLock(run.id);
    }
  }

  /** Dial one test call, then release the live-call lock. */
  private async executeTestCall(call: TestCallRecord): Promise<void> {
    try {
      await this.placeTestCall(call);
    } finally {
      this.releaseLock(call.id);
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
      captureQuestions: true,
      brief: event.brief ?? emptyEventBrief(),
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
      captureQuestions: false,
      brief: emptyEventBrief(),
      startedAt: call.startedAt,
      createdDetail: `pipeline test to ${call.to}`,
      persist: async (snapshot) => {
        await this.deps.storage.putTestCall({ ...call, ...snapshotForTest(snapshot) });
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
    return { ...call, ...snapshotForTest(snapshot) };
  }

  /** Build the in-memory live-call shell before dialing. */
  private openLiveCall(input: {
    attemptId: string;
    to: string;
    language: Language;
    fields: CaptureField[];
    captureQuestions: boolean;
    brief: EventBrief;
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
      captureQuestions: input.captureQuestions,
      brief: input.brief,
      snapshot: {
        status: 'dialing',
        outcome: null,
        startedAt: input.startedAt,
        endedAt: null,
        transcript: [],
        capturedFields: {},
        openQuestions: [],
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
      const limits = await this.resolveLimits();
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
        }, limits.dialTimeoutSeconds * 1000),
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

    const shouldExtract =
      outcome === 'answered' && (live.fields.length > 0 || live.captureQuestions);
    if (shouldExtract) {
      snapshot = this.record(
        { ...snapshot, status: 'extracting' },
        'extraction_started',
        this.deps.extraction.provider,
      );
      live.snapshot = snapshot;
      await this.persistLive(live);
      snapshot = await this.runExtraction(live, snapshot);
    } else {
      snapshot.capturedFields = allUnknown(live.fields);
      snapshot.openQuestions = [];
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
  private async runExtraction(live: LiveCall, snapshot: CallSnapshot): Promise<CallSnapshot> {
    try {
      const result = await this.deps.extraction.extract({
        fields: live.fields,
        transcript: snapshot.transcript,
        language: live.language,
        brief: live.brief,
        captureQuestions: live.captureQuestions,
      });
      const openQuestions = live.captureQuestions
        ? result.openQuestions.map((text) => ({ id: newQuestionId(), text, status: 'open' as const }))
        : [];
      const detail = [
        Object.keys(result.fields).join(', '),
        openQuestions.length > 0 ? `${openQuestions.length} open question(s)` : '',
      ]
        .filter(Boolean)
        .join('; ');
      return this.record(
        { ...snapshot, capturedFields: result.fields, openQuestions },
        'extraction_done',
        detail || null,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.record(
        {
          ...snapshot,
          capturedFields: allUnknown(live.fields),
          openQuestions: [],
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

  /**
   * Org settings own the live-call timers. Env limits are only a fallback when
   * settings cannot be read.
   */
  private async resolveLimits(): Promise<CallLimits> {
    try {
      const settings = await this.deps.storage.getSettings();
      return {
        maxCallSeconds: settings.maxCallSeconds,
        silenceSeconds: settings.silenceSeconds,
        dialTimeoutSeconds: settings.dialTimeoutSeconds,
      };
    } catch {
      return this.deps.limits;
    }
  }

  /** Bridge the answered call to the voice backend and arm the call guardrails. */
  private async startVoice(live: LiveCall, channel: AudioChannel): Promise<void> {
    const limits = await this.resolveLimits();
    let lastGuestTurnAt = Date.now();
    // Annotated because it re-arms itself: the guest may simply be slow, and
    // only a full quiet period should end the call.
    const armSilence = (): NodeJS.Timeout => {
      const timer = setTimeout(() => {
        if (live.settled) return;
        if (Date.now() - lastGuestTurnAt < limits.silenceSeconds * 1000) {
          live.timers.push(armSilence());
          return;
        }
        void this.deps.telephony.hangup(live.attemptId);
        live.settle({
          reason: 'completed',
          detail: `no guest speech for ${limits.silenceSeconds}s`,
          machine: false,
          error: null,
        });
      }, limits.silenceSeconds * 1000);
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
            detail: `maximum call length of ${limits.maxCallSeconds}s reached`,
            machine: false,
            error: null,
          });
        }, limits.maxCallSeconds * 1000),
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

/** Pipeline tests share the call snapshot but must not store guest questions. */
function snapshotForTest(snapshot: CallSnapshot): Omit<CallSnapshot, 'openQuestions'> {
  const { openQuestions: _questions, ...rest } = snapshot;
  return rest;
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
