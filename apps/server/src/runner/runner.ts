/**
 * Sequential campaign runner. It works through a queue one guest at a time,
 * enforcing the runtime guardrails before every dial, and it is the only place
 * that turns call lifecycle events into stored attempts. Calling one guest on
 * demand is the same path with a queue of one (DESIGN, phase 2).
 */
import type { CallLimits } from '../config.ts';
import type { ExtractionPort } from '../extraction/types.ts';
import { allUnknown } from '../extraction/types.ts';
import { newAttemptId, newRunId } from '../storage/ids.ts';
import type {
  AttemptEvent,
  AttemptEventKind,
  AttemptRecord,
  CallOutcome,
  CampaignRecord,
  EventRecord,
  GuestRecord,
  RunKind,
  RunRecord,
  Storage,
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

/** A second run was asked for while one is still going. */
export class RunConflictError extends Error {
  constructor(readonly runId: string) {
    super(`a run is already in progress: ${runId}`);
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

/** How one live call ended, before it is mapped to a stored outcome. */
interface CallResult {
  reason: CallEndReason;
  detail: string | null;
  machine: boolean;
  error: string | null;
}

/**
 * In-memory state for the single call that is up right now. `attempt` is the
 * one working copy: the dial path and the provider callbacks both go through it,
 * so neither can overwrite what the other just recorded.
 */
interface LiveCall {
  attemptId: string;
  attempt: AttemptRecord;
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
  private save(attempt: AttemptRecord): Promise<void> {
    const write = this.writes.then(() => this.deps.storage.putAttempt(attempt));
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

  /**
   * A restart kills every live call, so nothing may still look in flight. Runs
   * and attempts left unfinished are closed as interrupted and the organizer
   * decides whether to start again (DESIGN, error handling).
   */
  async reconcileOnStartup(): Promise<{ attempts: number; runs: number }> {
    let attempts = 0;
    let runs = 0;
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

    if (attempts > 0 || runs > 0) {
      this.log(`marked ${runs} run(s) and ${attempts} attempt(s) as interrupted`);
    }
    return { attempts, runs };
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
   * One call end to end: create the attempt, dial, bridge the voice backend
   * while it is up, then map the end reason and extract the campaign's fields.
   */
  private async placeCall(
    event: EventRecord,
    campaign: CampaignRecord,
    guest: GuestRecord,
    runId: string,
  ): Promise<AttemptRecord> {
    const startedAt = this.now().toISOString();
    const attemptId = newAttemptId(startedAt);
    const live: LiveCall = {
      attemptId,
      attempt: {
        id: attemptId,
        eventId: event.id,
        campaignId: campaign.id,
        guestId: guest.id,
        runId,
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
        timeline: [{ at: startedAt, kind: 'created', detail: `queued for ${guest.name}` }],
        error: null,
      },
      session: null,
      answered: false,
      guestSpoke: false,
      settled: false,
      timers: [],
      settle: () => {},
    };

    this.live = live;
    await this.save(live.attempt);

    const run = await this.deps.storage.getRun(event.id, runId);
    if (run) {
      await this.patchRun(run, { currentGuestId: guest.id, currentAttemptId: attemptId });
    }

    const settled = new Promise<CallResult>((resolve) => {
      live.settle = (result) => {
        if (live.settled) return;
        live.settled = true;
        for (const timer of live.timers) clearTimeout(timer);
        resolve(result);
      };
    });

    // The dial itself can fail before any callback arrives.
    try {
      this.advance(live, 'dialing', `dialing ${guest.phone}`);
      const { providerCallId } = await this.deps.telephony.dial({ attemptId, to: guest.phone });
      live.attempt = { ...live.attempt, providerCallId };
      await this.save(live.attempt);

      live.timers.push(
        setTimeout(() => {
          if (live.answered || live.settled) return;
          void this.deps.telephony.hangup(attemptId);
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
    let attempt = this.record(
      { ...live.attempt, endedAt: this.now().toISOString(), outcome },
      'call_ended',
      [outcome, result.detail].filter(Boolean).join(': '),
    );
    if (result.error) attempt.error = result.error;

    if (outcome === 'answered' && campaign.fields.length > 0) {
      attempt = this.record(
        { ...attempt, status: 'extracting' },
        'extraction_started',
        this.deps.extraction.provider,
      );
      await this.save(attempt);
      attempt = await this.runExtraction(attempt, campaign);
    } else {
      attempt.capturedFields = allUnknown(campaign.fields);
    }

    attempt.status = 'done';
    await this.save(attempt);
    this.log(`attempt ${attempt.id} for ${guest.name} ended as ${outcome}`);
    return attempt;
  }

  /** Append a lifecycle step to the live call and persist it in one move. */
  private advance(
    live: LiveCall,
    kind: AttemptEventKind,
    detail: string | null,
    patch: Partial<AttemptRecord> = {},
  ): void {
    live.attempt = this.record({ ...live.attempt, ...patch }, kind, detail);
    void this.save(live.attempt);
  }

  /**
   * Extraction never loses a call: a failure keeps the transcript, leaves the
   * fields unknown, and records the error so it can be re-run later.
   */
  private async runExtraction(
    attempt: AttemptRecord,
    campaign: CampaignRecord,
  ): Promise<AttemptRecord> {
    try {
      const captured = await this.deps.extraction.extract({
        fields: campaign.fields,
        transcript: attempt.transcript,
        language: campaign.language,
      });
      return this.record(
        { ...attempt, capturedFields: captured },
        'extraction_done',
        Object.keys(captured).join(', ') || null,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.record(
        {
          ...attempt,
          capturedFields: allUnknown(campaign.fields),
          error: attempt.error ?? `extraction failed: ${message}`,
        },
        'extraction_failed',
        message,
      );
    }
  }

  private record(attempt: AttemptRecord, kind: AttemptEventKind, detail: string | null): AttemptRecord {
    const event: AttemptEvent = { at: this.now().toISOString(), kind, detail: detail || null };
    return { ...attempt, timeline: [...attempt.timeline, event] };
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
    const campaign = await this.deps.storage.getCampaign(
      live.attempt.eventId,
      live.attempt.campaignId,
    );
    const event = await this.deps.storage.getEvent(live.attempt.eventId);
    const guest = await this.deps.storage.getGuest(live.attempt.eventId, live.attempt.guestId);
    if (!campaign || !event || !guest) return;

    // Read at call time, so a master prompt or context change applies to the
    // next guest in a running queue.
    const settings = await this.deps.storage.getSettings();

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

    try {
      const session = await this.deps.voice.start({
        attemptId: live.attempt.id,
        prompt: assemblePrompt({ event, campaign, guest, settings }),
        language: campaign.language,
        channel,
        onTranscript: (turn: TranscriptTurn) => {
          if (turn.role === 'guest') {
            live.guestSpoke = true;
            lastGuestTurnAt = Date.now();
          }
          live.attempt = {
            ...live.attempt,
            transcript: [...live.attempt.transcript, turn],
          };
          void this.save(live.attempt);
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

      // The call can end while the backend is still opening its session.
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
