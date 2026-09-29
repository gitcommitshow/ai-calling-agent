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
  EventRecord,
  GuestRecord,
  RunRecord,
  Storage,
  TestCallRecord,
} from './types.ts';
import { defaultOrgSettings, type OrgSettings } from './settings.ts';

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

  constructor(private readonly dataDir: string) {
    this.eventsDir = join(dataDir, 'events');
    this.settingsPath = join(dataDir, 'settings.json');
    this.testCallsDir = join(dataDir, 'test-calls');
  }

  /** Org settings sit next to events/, one file for the whole deployment. */
  async getSettings(): Promise<OrgSettings> {
    const stored = await readJson<OrgSettings>(this.settingsPath);
    if (!stored) return defaultOrgSettings();
    return {
      ...defaultOrgSettings(stored.updatedAt),
      ...stored,
      masterPrompts: {
        ...defaultOrgSettings().masterPrompts,
        ...stored.masterPrompts,
      },
      contextFields: stored.contextFields ?? defaultOrgSettings().contextFields,
      testNumber: typeof stored.testNumber === 'string' ? stored.testNumber : null,
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
    return readJson<EventRecord>(join(this.eventDir(eventId), 'event.json'));
  }

  async putEvent(event: EventRecord): Promise<void> {
    await writeJsonAtomic(join(this.eventDir(event.id), 'event.json'), event);
  }

  async listGuests(eventId: string): Promise<GuestRecord[]> {
    return readJsonDir<GuestRecord>(join(this.eventDir(eventId), 'guests'));
  }

  async getGuest(eventId: string, guestId: string): Promise<GuestRecord | null> {
    assertSafeId('guest', guestId);
    return readJson<GuestRecord>(join(this.eventDir(eventId), 'guests', `${guestId}.json`));
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
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getRun(eventId: string, runId: string): Promise<RunRecord | null> {
    assertSafeId('run', runId);
    return readJson<RunRecord>(join(this.eventDir(eventId), 'runs', `${runId}.json`));
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
  return {
    ...campaign,
    useMasterPrompt: campaign.useMasterPrompt === true,
  };
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
    fallbackUsed: attempt.fallbackUsed === true,
    providerCallId: attempt.providerCallId ?? null,
    voiceSessionId: attempt.voiceSessionId ?? null,
    timeline: Array.isArray(attempt.timeline) ? attempt.timeline : [],
    error: attempt.error ?? null,
  };
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
