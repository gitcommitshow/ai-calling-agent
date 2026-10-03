/**
 * JSON-file implementation of the storage contract. One folder per event, one
 * file per record, so each write stays small and events stay isolated.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  listRecordIds,
  readJson,
  readJsonDir,
  removeFile,
  writeJsonAtomic,
} from './atomic.ts';
import type {
  AttemptRecord,
  CampaignRecord,
  EventBrief,
  EventRecord,
  GuestRecord,
  OpenQuestion,
  RunRecord,
  Storage,
  TestCallRecord,
} from './types.ts';
import {
  defaultOrgSettings,
  normalizeExtraction,
  normalizeTelephonyProvider,
  normalizeVoiceProvider,
  type OrgSettings,
  type SettingsSeeds,
} from './settings.ts';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Reject anything that could escape the data folder before it reaches the filesystem. */
function assertSafeId(kind: string, id: string): void {
  if (!SAFE_ID.test(id) || id.includes('..')) {
    throw new Error(`invalid ${kind} id: ${id}`);
  }
}

export class JsonStore implements Storage {
  private readonly eventsDir: string;
  private readonly settingsPath: string;
  private readonly testCallsDir: string;

  constructor(
    private readonly dataDir: string,
    private readonly seeds: SettingsSeeds = {},
  ) {
    this.eventsDir = join(dataDir, 'events');
    this.settingsPath = join(dataDir, 'settings.json');
    this.testCallsDir = join(dataDir, 'test-calls');
  }

  /** Org settings sit next to events/, one file for the whole deployment. */
  async getSettings(): Promise<OrgSettings> {
    const stored = await readJson<Partial<OrgSettings>>(this.settingsPath);
    const defaults = defaultOrgSettings(stored?.updatedAt);
    const seeded = applySettingsSeeds(defaults, this.seeds);
    if (!stored) return seeded;
    return {
      ...seeded,
      ...stored,
      masterPrompts: {
        ...seeded.masterPrompts,
        ...(stored.masterPrompts ?? {}),
      },
      contextFields: stored.contextFields ?? seeded.contextFields,
      testNumber: typeof stored.testNumber === 'string' ? stored.testNumber : null,
      callingWindow: normalizeCallingWindow(stored.callingWindow, seeded.callingWindow),
      retryCap: clampRetryCap(stored.retryCap, seeded.retryCap),
      silenceSeconds: positiveLimit(stored.silenceSeconds, seeded.silenceSeconds, 5, 600),
      maxCallSeconds: positiveLimit(stored.maxCallSeconds, seeded.maxCallSeconds, 30, 3600),
      dialTimeoutSeconds: positiveLimit(
        stored.dialTimeoutSeconds,
        seeded.dialTimeoutSeconds,
        10,
        180,
      ),
      extraction: normalizeExtraction(stored.extraction, seeded.extraction),
      voiceProvider: normalizeVoiceProvider(stored.voiceProvider, seeded.voiceProvider),
      telephonyProvider: normalizeTelephonyProvider(
        stored.telephonyProvider,
        seeded.telephonyProvider,
      ),
      updatedAt: stored.updatedAt ?? seeded.updatedAt,
    };
  }

  async putSettings(settings: OrgSettings): Promise<void> {
    await writeJsonAtomic(this.settingsPath, settings);
  }

  private eventDir(eventId: string): string {
    assertSafeId('event', eventId);
    return join(this.eventsDir, eventId);
  }

  async listEvents(): Promise<EventRecord[]> {
    const ids = await listDirNames(this.eventsDir);
    const events: EventRecord[] = [];
    for (const id of ids) {
      const event = await this.getEvent(id);
      if (event) events.push(event);
    }
    return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getEvent(eventId: string): Promise<EventRecord | null> {
    const event = await readJson<EventRecord>(join(this.eventDir(eventId), 'event.json'));
    return event ? normalizeEvent(event) : null;
  }

  async putEvent(event: EventRecord): Promise<void> {
    await writeJsonAtomic(join(this.eventDir(event.id), 'event.json'), event);
  }

  async listGuests(eventId: string): Promise<GuestRecord[]> {
    const guests = await readJsonDir<GuestRecord>(join(this.eventDir(eventId), 'guests'));
    return guests.map(normalizeGuest);
  }

  async getGuest(eventId: string, guestId: string): Promise<GuestRecord | null> {
    assertSafeId('guest', guestId);
    const guest = await readJson<GuestRecord>(join(this.eventDir(eventId), 'guests', `${guestId}.json`));
    return guest ? normalizeGuest(guest) : null;
  }

  /** Import semantics: the uploaded list becomes the whole guest list for the event. */
  async replaceGuests(eventId: string, guests: GuestRecord[]): Promise<void> {
    const dir = join(this.eventDir(eventId), 'guests');
    const existing = new Set(await listRecordIds(dir));

    for (const guest of guests) {
      assertSafeId('guest', guest.id);
      await writeJsonAtomic(join(dir, `${guest.id}.json`), guest);
      existing.delete(guest.id);
    }
    for (const staleId of existing) {
      await removeFile(join(dir, `${staleId}.json`));
    }
  }

  async listCampaigns(eventId: string): Promise<CampaignRecord[]> {
    const campaigns = await readJsonDir<CampaignRecord>(
      join(this.eventDir(eventId), 'campaigns'),
    );
    return campaigns.map(normalizeCampaign).sort((a, b) => a.type.localeCompare(b.type));
  }

  async getCampaign(eventId: string, campaignId: string): Promise<CampaignRecord | null> {
    assertSafeId('campaign', campaignId);
    const campaign = await readJson<CampaignRecord>(
      join(this.eventDir(eventId), 'campaigns', `${campaignId}.json`),
    );
    return campaign ? normalizeCampaign(campaign) : null;
  }

  /** Campaign ids are unique across events, so a lookup can scan event folders. */
  async findCampaign(campaignId: string): Promise<CampaignRecord | null> {
    assertSafeId('campaign', campaignId);
    for (const eventId of await listDirNames(this.eventsDir)) {
      const campaign = await this.getCampaign(eventId, campaignId);
      if (campaign) return campaign;
    }
    return null;
  }

  async putCampaign(campaign: CampaignRecord): Promise<void> {
    assertSafeId('campaign', campaign.id);
    await writeJsonAtomic(
      join(this.eventDir(campaign.eventId), 'campaigns', `${campaign.id}.json`),
      campaign,
    );
  }

  async listAttempts(eventId: string): Promise<AttemptRecord[]> {
    const attempts = await readJsonDir<AttemptRecord>(join(this.eventDir(eventId), 'attempts'));
    return attempts
      .map(normalizeAttempt)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getAttempt(eventId: string, attemptId: string): Promise<AttemptRecord | null> {
    assertSafeId('attempt', attemptId);
    const attempt = await readJson<AttemptRecord>(
      join(this.eventDir(eventId), 'attempts', `${attemptId}.json`),
    );
    return attempt ? normalizeAttempt(attempt) : null;
  }

  async putAttempt(attempt: AttemptRecord): Promise<void> {
    assertSafeId('attempt', attempt.id);
    await writeJsonAtomic(
      join(this.eventDir(attempt.eventId), 'attempts', `${attempt.id}.json`),
      attempt,
    );
  }

  async listRuns(eventId: string): Promise<RunRecord[]> {
    const runs = await readJsonDir<RunRecord>(join(this.eventDir(eventId), 'runs'));
    return runs.map(normalizeRun).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getRun(eventId: string, runId: string): Promise<RunRecord | null> {
    assertSafeId('run', runId);
    const run = await readJson<RunRecord>(join(this.eventDir(eventId), 'runs', `${runId}.json`));
    return run ? normalizeRun(run) : null;
  }

  /** Run ids are unique across events, so a lookup can scan event folders. */
  async findRun(runId: string): Promise<RunRecord | null> {
    assertSafeId('run', runId);
    for (const eventId of await listDirNames(this.eventsDir)) {
      const run = await this.getRun(eventId, runId);
      if (run) return run;
    }
    return null;
  }

  async putRun(run: RunRecord): Promise<void> {
    assertSafeId('run', run.id);
    await writeJsonAtomic(join(this.eventDir(run.eventId), 'runs', `${run.id}.json`), run);
  }

  async listEventIds(): Promise<string[]> {
    return listDirNames(this.eventsDir);
  }

  /** Pipeline tests live next to events/, never inside an event folder. */
  async listAllTestCalls(): Promise<TestCallRecord[]> {
    const calls = await readJsonDir<TestCallRecord>(this.testCallsDir);
    return calls.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listTestCalls(eventId: string | null): Promise<TestCallRecord[]> {
    const calls = await this.listAllTestCalls();
    return calls.filter((call) =>
      eventId === null ? call.eventId === null : call.eventId === eventId,
    );
  }

  async getTestCall(id: string): Promise<TestCallRecord | null> {
    assertSafeId('test-call', id);
    return readJson<TestCallRecord>(join(this.testCallsDir, `${id}.json`));
  }

  async putTestCall(call: TestCallRecord): Promise<void> {
    assertSafeId('test-call', call.id);
    await writeJsonAtomic(join(this.testCallsDir, `${call.id}.json`), call);
  }

  /** Exposed for the seed script and tests that want to inspect the folder. */
  get root(): string {
    return this.dataDir;
  }
}

/**
 * Older campaign files omit useMasterPrompt. Treat that as custom so existing
 * event-level prompts keep working until the organizer opts into the master.
 */
function normalizeCampaign(campaign: CampaignRecord): CampaignRecord {
  const normalized: CampaignRecord = {
    ...campaign,
    useMasterPrompt: campaign.useMasterPrompt === true,
    purpose: typeof campaign.purpose === 'string' ? campaign.purpose : '',
    retryCap: clampRetryCap(campaign.retryCap, 1),
  };
  const retryCapOverrides = normalizeRetryCapOverrides(campaign.retryCapOverrides);
  if (retryCapOverrides) normalized.retryCapOverrides = retryCapOverrides;
  else delete normalized.retryCapOverrides;
  return normalized;
}

/**
 * Attempt ceiling. Keep in step with MAX_GUEST_ATTEMPTS in runner/retry-cap.ts.
 * Values above it clamp down so an older file cannot allow more than five.
 */
function clampRetryCap(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(5, Math.max(1, value));
}

/** Drop caps that are not a whole number of at least 1, and clamp the rest to the ceiling. */
function normalizeRetryCapOverrides(
  value: CampaignRecord['retryCapOverrides'],
): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const overrides: Record<string, number> = {};
  for (const [guestId, cap] of Object.entries(value)) {
    if (!SAFE_ID.test(guestId) || guestId.includes('..')) continue;
    if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1) continue;
    overrides[guestId] = Math.min(5, cap);
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/** Older guest files have no origin. Those guests came from an import. */
function normalizeGuest(guest: GuestRecord): GuestRecord {
  return { ...guest, origin: guest.origin === 'manual' ? 'manual' : 'imported' };
}

/** Older event files have no brief and no Luma link. Both stay empty. */
function normalizeEvent(event: EventRecord): EventRecord {
  const sourceUrl = typeof event.sourceUrl === 'string' ? event.sourceUrl.trim() : '';
  return {
    ...event,
    brief: normalizeBrief(event.brief),
    sourceUrl: sourceUrl || null,
  };
}

/** Keep only string fields, so a partial or missing brief cannot crash prompt assembly. */
function normalizeBrief(brief: EventBrief | undefined): EventBrief {
  return {
    about: typeof brief?.about === 'string' ? brief.about : '',
    where: typeof brief?.where === 'string' ? brief.where : '',
    notes: typeof brief?.notes === 'string' ? brief.notes : '',
  };
}

/** Older runs are immediate dials, so they still honor the retry cap and have no start time. */
function normalizeRun(run: RunRecord): RunRecord {
  const scheduledFor = typeof run.scheduledFor === 'string' && run.scheduledFor ? run.scheduledFor : null;
  return {
    ...run,
    waiveRetryCap: run.waiveRetryCap === true,
    waiveCallingWindow: run.waiveCallingWindow === true,
    scheduledFor,
  };
}

/** Environment seeds fill only the fields a settings file has never saved. */
function applySettingsSeeds(settings: OrgSettings, seeds: SettingsSeeds): OrgSettings {
  return {
    ...settings,
    extraction: normalizeExtraction(seeds.extraction, settings.extraction),
    voiceProvider: normalizeVoiceProvider(seeds.voiceProvider, settings.voiceProvider),
    telephonyProvider: normalizeTelephonyProvider(
      seeds.telephonyProvider,
      settings.telephonyProvider,
    ),
  };
}

/** Fill a missing or partial calling window from the org default. */
function normalizeCallingWindow(
  value: OrgSettings['callingWindow'] | undefined,
  fallback: OrgSettings['callingWindow'],
): OrgSettings['callingWindow'] {
  if (!value || typeof value !== 'object') return fallback;
  const start = typeof value.start === 'string' ? value.start : fallback.start;
  const end = typeof value.end === 'string' ? value.end : fallback.end;
  const timezone = typeof value.timezone === 'string' ? value.timezone : fallback.timezone;
  return { start, end, timezone };
}

/** Keep a stored limit inside its allowed range, or fall back. */
function positiveLimit(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

/**
 * Older attempt files omit status, timeline, and provider ids. One that already
 * has an outcome is a finished call, so a restart must not close it out again.
 */
function normalizeAttempt(attempt: AttemptRecord): AttemptRecord {
  const finished = attempt.status === 'done' || attempt.outcome != null || attempt.endedAt != null;
  return {
    ...attempt,
    status: finished ? 'done' : (attempt.status ?? 'dialing'),
    runId: attempt.runId ?? null,
    transcript: Array.isArray(attempt.transcript) ? attempt.transcript : [],
    capturedFields: attempt.capturedFields ?? {},
    openQuestions: normalizeOpenQuestions(attempt.openQuestions),
    fallbackUsed: attempt.fallbackUsed === true,
    providerCallId: attempt.providerCallId ?? null,
    voiceSessionId: attempt.voiceSessionId ?? null,
    timeline: Array.isArray(attempt.timeline) ? attempt.timeline : [],
    error: attempt.error ?? null,
  };
}

/** Drop anything that is not a stored question, so a bad file cannot surface a blank. */
function normalizeOpenQuestions(value: unknown): OpenQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions: OpenQuestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<OpenQuestion>;
    if (typeof record.id !== 'string' || typeof record.text !== 'string') continue;
    const text = record.text.trim();
    if (!text) continue;
    questions.push({
      id: record.id,
      text,
      status: record.status === 'resolved' ? 'resolved' : 'open',
    });
  }
  return questions;
}

async function listDirNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
