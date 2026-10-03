/**
 * The JSON HTTP API for the web app. Routes validate, persist, and read back.
 * Product rules (filtering, ordering, eligibility, prompt text) stay in the web
 * app; this layer only guards the data.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { HttpError, badRequest, notFound, readJsonBody, sendError, sendJson } from './http.ts';
import {
  parseCallRequestInput,
  parseCampaignInput,
  parseCampaignPatch,
  parseEventInput,
  parseGuestImportInput,
  parseGuestRetryCap,
  parseManualGuestInput,
  parseOrgSettingsInput,
  parseRunStartInput,
  parseTestCallRequestInput,
  type TestCallPromptSourceInput,
} from './validate.ts';
import { importLumaEvent, refreshLumaEvent } from '../luma/page.ts';
import { addManualGuest, applyGuestImport, ExistingGuestError } from '../guests/roster.ts';
import { newCampaignId, newEventId } from '../storage/ids.ts';
import { CALL_OUTCOMES } from '../storage/types.ts';
import type {
  AttemptRecord,
  CallOutcome,
  CampaignRecord,
  CaptureField,
  EventRecord,
  GuestRecord,
  Language,
  RunRecord,
  Storage,
  TestCallPromptSource,
  TestCallRecord,
} from '../storage/types.ts';
import {
  retryCapOverridesForGuests,
  sameRetryCapOverrides,
  withGuestRetryCap,
} from '../runner/retry-cap.ts';
import type { ProviderAvailability } from '../config.ts';
import { GuardrailError, RunConflictError, type CallRunner } from '../runner/runner.ts';
import { adoptProviderSelection, type ProviderSelection } from '../storage/settings.ts';
import type { TelephonyPort } from '../telephony/types.ts';
import {
  parseAgentHangupInput,
  type AgentHangupSettings,
  type VoiceHangupPort,
} from '../voice/agent-hangup.ts';

/**
 * What the API needs beyond storage to place calls. Left optional so the data
 * and campaign endpoints still serve when no provider is configured.
 */
export interface ApiServices {
  runner: CallRunner;
  telephony: TelephonyPort;
  /** Variables still unset before a real call can be placed, if any. */
  missingConfig?: () => string[];
  /** Live provider choice. Updated when settings are saved. */
  providerSelection?: ProviderSelection;
  /** Whether each provider already has credentials. Never includes the key. */
  providerAvailability?: (extractionProvider: string) => ProviderAvailability;
  /** STRICT_CALLING_HOURS. Omitted means soft, so older callers stay compatible. */
  callingHoursMode?: 'strict' | 'soft';
  /** ElevenLabs End call tool. Omitted when the agent credentials are unset. */
  voiceHangup?: VoiceHangupPort;
}

interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  storage: Storage;
  services?: ApiServices;
}

interface RouteResult {
  status: number;
  body?: unknown;
}

interface Route {
  method: string;
  segments: string[];
  handle(ctx: RouteContext): Promise<RouteResult>;
}

function route(
  method: string,
  pattern: string,
  handle: (ctx: RouteContext) => Promise<RouteResult>,
): Route {
  return { method, segments: pattern.split('/').filter(Boolean), handle };
}

/** The homepage sends `{ url }` for a Luma page. */
function lumaUrlFrom(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('url is required');
  }
  const url = (body as { url?: unknown }).url;
  if (typeof url !== 'string' || url.trim() === '') throw badRequest('url is required');
  return url;
}

async function loadEvent(storage: Storage, eventId: string): Promise<EventRecord> {
  const event = await storage.getEvent(eventId);
  if (!event) throw notFound(`event not found: ${eventId}`);
  return event;
}

async function loadCampaign(storage: Storage, campaignId: string): Promise<CampaignRecord> {
  const campaign = await storage.findCampaign(campaignId);
  if (!campaign) throw notFound(`campaign not found: ${campaignId}`);
  return campaign;
}

/**
 * Calling endpoints refuse clearly rather than half-working: no wiring is a 501,
 * and a missing credential is a 503 that names the variable to set.
 */
function requireCalling(services: ApiServices | undefined): ApiServices {
  if (!services) {
    throw new HttpError(501, 'this server was started without telephony and voice backends');
  }
  const missing = services.missingConfig?.() ?? [];
  if (missing.length > 0) {
    throw new HttpError(503, `calling is not configured yet, missing: ${missing.join(', ')}`);
  }
  return services;
}

/** Status of the End call tool for the settings page. Never includes the API key. */
function voiceHangupView(
  hangup: VoiceHangupPort | undefined,
  settings: AgentHangupSettings | null,
  error: string | null,
) {
  if (!hangup || !settings) {
    return {
      available: false,
      enabled: false,
      description: '',
      agentId: hangup?.agentId ?? null,
      error:
        error ??
        'ElevenLabs needs ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID before this server can read the agent hangup tool.',
    };
  }
  return {
    available: true,
    enabled: settings.enabled,
    description: settings.description,
    agentId: hangup.agentId,
    error: null,
  };
}

/** Read the tool for the settings page. A provider failure stays on this card. */
async function readVoiceHangup(hangup: VoiceHangupPort | undefined) {
  if (!hangup) return voiceHangupView(undefined, null, null);
  try {
    return voiceHangupView(hangup, await hangup.read(), null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'could not read the agent hangup tool';
    return voiceHangupView(hangup, null, message);
  }
}

/** Turn a runner refusal into the status the organizer's UI expects. */
async function startRun(
  services: ApiServices,
  campaign: CampaignRecord,
  options: {
    kind: 'queue' | 'single';
    guestIds?: string[];
    waiveRetryCap?: boolean;
    waiveCallingWindow?: boolean;
  },
): Promise<RunRecord> {
  try {
    return await services.runner.startRun(campaign, options);
  } catch (error) {
    if (error instanceof RunConflictError) throw new HttpError(409, error.message);
    if (error instanceof GuardrailError) throw new HttpError(400, error.message);
    throw error;
  }
}

/** Save a later start. 409 when another run is already waiting. */
async function scheduleRun(
  services: ApiServices,
  campaign: CampaignRecord,
  startsAt: Date,
  options: { waiveCallingWindow?: boolean } = {},
): Promise<RunRecord> {
  try {
    return await services.runner.scheduleRun(campaign, startsAt, options);
  } catch (error) {
    if (error instanceof RunConflictError) throw new HttpError(409, error.message);
    if (error instanceof GuardrailError) throw new HttpError(400, error.message);
    throw error;
  }
}

/** Start a pipeline test; 409 when a guest run or another test is already live. */
async function startTestCall(
  services: ApiServices,
  input: Parameters<CallRunner['startTestCall']>[0],
): Promise<TestCallRecord> {
  try {
    return await services.runner.startTestCall(input);
  } catch (error) {
    if (error instanceof RunConflictError) throw new HttpError(409, error.message);
    throw error;
  }
}

/**
 * Same rule as apps/web/src/domain/default-campaign.ts: before the start,
 * pre-event; after it, post-event. Kept here so one-click tests resolve on
 * the server even when the client sends `{ kind: 'default' }`.
 */
function pickDefaultCampaign(
  campaigns: CampaignRecord[],
  event: Pick<EventRecord, 'startsAt'>,
  now: Date,
): CampaignRecord | undefined {
  if (campaigns.length === 0) return undefined;
  const preferred = now < new Date(event.startsAt) ? 'pre-event' : 'post-event';
  return campaigns.find((campaign) => campaign.type === preferred) ?? campaigns[0];
}

/** Resolve number, prompt source, language, and fields for one test call. */
async function resolveTestCall(
  storage: Storage,
  input: {
    eventId: string | null;
    to: string | null;
    promptSource: TestCallPromptSourceInput;
  },
): Promise<{
  eventId: string | null;
  to: string;
  promptSource: TestCallPromptSource;
  language: Language;
  fields: CaptureField[];
}> {
  const settings = await storage.getSettings();
  const to = input.to ?? settings.testNumber;
  if (!to) {
    throw badRequest('set a test number in settings, or enter a number for this call');
  }

  const event = input.eventId ? await loadEvent(storage, input.eventId) : null;
  const now = new Date();
  const campaigns = event ? await storage.listCampaigns(event.id) : [];
  const fallback = event ? pickDefaultCampaign(campaigns, event, now) : undefined;

  if (input.promptSource.kind === 'default') {
    if (!event) {
      return { eventId: null, to, promptSource: { kind: 'builtin' }, language: 'en', fields: [] };
    }
    if (fallback) {
      return {
        eventId: event.id,
        to,
        promptSource: { kind: 'campaign', campaignId: fallback.id },
        language: fallback.language,
        fields: fallback.fields,
      };
    }
    return {
      eventId: event.id,
      to,
      promptSource: { kind: 'master', campaignType: 'pre-event' },
      language: 'en',
      fields: [],
    };
  }

  if (input.promptSource.kind === 'master') {
    return {
      eventId: event?.id ?? null,
      to,
      promptSource: { kind: 'master', campaignType: input.promptSource.campaignType },
      language: fallback?.language ?? 'en',
      fields: [],
    };
  }

  if (input.promptSource.kind === 'campaign') {
    const campaign = await loadCampaign(storage, input.promptSource.campaignId);
    if (event && campaign.eventId !== event.id) {
      throw badRequest('campaign does not belong to this event');
    }
    return {
      eventId: event?.id ?? null,
      to,
      promptSource: { kind: 'campaign', campaignId: campaign.id },
      language: campaign.language,
      fields: campaign.fields,
    };
  }

  return {
    eventId: event?.id ?? null,
    to,
    promptSource: { kind: 'custom', prompt: input.promptSource.prompt },
    language: fallback?.language ?? 'en',
    fields: [],
  };
}

/** Drop queue entries and per-guest attempt limits whose guest is no longer on the list. */
async function pruneQueues(storage: Storage, eventId: string, guestIds: Set<string>): Promise<number> {
  let removed = 0;
  for (const campaign of await storage.listCampaigns(eventId)) {
    const queue = campaign.queue.filter((guestId) => guestIds.has(guestId));
    const retryCapOverrides = retryCapOverridesForGuests(campaign.retryCapOverrides, guestIds);
    const queueChanged = queue.length !== campaign.queue.length;
    const overridesChanged = !sameRetryCapOverrides(retryCapOverrides, campaign.retryCapOverrides);
    if (!queueChanged && !overridesChanged) continue;
    removed += campaign.queue.length - queue.length;
    const next: CampaignRecord = { ...campaign, queue, updatedAt: new Date().toISOString() };
    if (retryCapOverrides) next.retryCapOverrides = retryCapOverrides;
    else delete next.retryCapOverrides;
    await storage.putCampaign(next);
  }
  return removed;
}

function emptyOutcomeTally(): Record<CallOutcome, number> {
  return Object.fromEntries(CALL_OUTCOMES.map((outcome) => [outcome, 0])) as Record<
    CallOutcome,
    number
  >;
}

const routes: Route[] = [
  route('GET', '/health', async ({ services }) => ({
    status: 200,
    body: {
      ok: true,
      calling: services
        ? { ready: (services.missingConfig?.() ?? []).length === 0, missing: services.missingConfig?.() ?? [] }
        : { ready: false, missing: ['telephony and voice backends are not wired in'] },
    },
  })),

  route('GET', '/settings', async ({ storage, services }) => {
    const settings = await storage.getSettings();
    return {
      status: 200,
      body: {
        settings,
        callingHoursMode: services?.callingHoursMode === 'strict' ? 'strict' : 'soft',
        providerAvailability:
          services?.providerAvailability?.(settings.extraction.provider) ?? null,
      },
    };
  }),

  route('GET', '/settings/voice-hangup', async ({ services }) => ({
    status: 200,
    body: { voiceHangup: await readVoiceHangup(services?.voiceHangup) },
  })),

  route('PUT', '/settings/voice-hangup', async ({ body, services }) => {
    const hangup = services?.voiceHangup;
    if (!hangup) {
      throw new HttpError(
        503,
        'ElevenLabs needs ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID before this server can change the agent hangup tool.',
      );
    }
    let input: AgentHangupSettings;
    try {
      input = parseAgentHangupInput(body);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'invalid hangup settings');
    }
    try {
      const saved = await hangup.update(input);
      return { status: 200, body: { voiceHangup: voiceHangupView(hangup, saved, null) } };
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : 'could not update the agent hangup tool',
      );
    }
  }),

  route('PUT', '/settings', async ({ body, storage, services }) => {
    const input = parseOrgSettingsInput(body);
    const settings = { ...input, updatedAt: new Date().toISOString() };
    await storage.putSettings(settings);
    if (services?.providerSelection) adoptProviderSelection(services.providerSelection, settings);
    return { status: 200, body: { settings } };
  }),

  route('GET', '/test-calls', async ({ query, storage }) => {
    const eventId = query.get('eventId');
    if (eventId) await loadEvent(storage, eventId);
    return {
      status: 200,
      body: { testCalls: await storage.listTestCalls(eventId) },
    };
  }),

  /**
   * Place a pipeline test. The only calling endpoint that may take a phone
   * number from the request. Guest dials still read the number from storage.
   */
  route('POST', '/test-calls', async ({ body, storage, services }) => {
    const calling = requireCalling(services);
    const input = parseTestCallRequestInput(body);
    const resolved = await resolveTestCall(storage, input);
    const testCall = await startTestCall(calling, resolved);
    return { status: 202, body: { testCall } };
  }),

  route('POST', '/test-calls/:testCallId/stop', async ({ params, services }) => {
    const calling = requireCalling(services);
    const testCall = await calling.runner.stopTestCall(params.testCallId!);
    if (!testCall) throw notFound(`test call not found: ${params.testCallId}`);
    return { status: 200, body: { testCall } };
  }),

  route('GET', '/events', async ({ storage }) => ({
    status: 200,
    body: { events: await storage.listEvents() },
  })),

  route('POST', '/events/from-luma', async ({ body, storage }) => {
    const url = lumaUrlFrom(body);
    const result = await importLumaEvent(storage, url);
    return { status: result.created ? 201 : 200, body: result };
  }),

  route('POST', '/events/:eventId/refresh-luma', async ({ params, storage }) => {
    const event = await refreshLumaEvent(storage, params.eventId!);
    return { status: 200, body: { event } };
  }),

  route('POST', '/events', async ({ body, storage }) => {
    const input = parseEventInput(body);
    const now = new Date().toISOString();
    const event: EventRecord = {
      id: newEventId(input.name),
      name: input.name,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      brief: input.brief,
      sourceUrl: null,
      lastImport: null,
      createdAt: now,
      updatedAt: now,
    };
    await storage.putEvent(event);
    return { status: 201, body: { event } };
  }),

  route('GET', '/events/:eventId', async ({ params, storage }) => ({
    status: 200,
    body: { event: await loadEvent(storage, params.eventId!) },
  })),

  route('PUT', '/events/:eventId', async ({ params, body, storage }) => {
    const existing = await loadEvent(storage, params.eventId!);
    const input = parseEventInput(body);
    const event: EventRecord = {
      ...existing,
      name: input.name,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      brief: input.brief,
      sourceUrl: existing.sourceUrl,
      updatedAt: new Date().toISOString(),
    };
    await storage.putEvent(event);
    return { status: 200, body: { event } };
  }),

  route('GET', '/events/:eventId/guests', async ({ params, storage }) => {
    await loadEvent(storage, params.eventId!);
    return { status: 200, body: { guests: await storage.listGuests(params.eventId!) } };
  }),

  route('POST', '/events/:eventId/guests', async ({ params, body, storage }) => {
    const event = await loadEvent(storage, params.eventId!);
    const input = parseManualGuestInput(body);
    try {
      const guest = await addManualGuest(storage, event.id, input);
      return { status: 201, body: { guest } };
    } catch (error) {
      if (error instanceof ExistingGuestError) throw new HttpError(409, error.message);
      throw error;
    }
  }),

  route('POST', '/events/:eventId/guests/import', async ({ params, body, storage }) => {
    const event = await loadEvent(storage, params.eventId!);
    const input = parseGuestImportInput(body);
    const existing = await storage.listGuests(event.id);
    const merged = applyGuestImport(existing, input.guests);

    await storage.replaceGuests(event.id, merged.guests);
    const removedFromQueues = await pruneQueues(
      storage,
      event.id,
      new Set(merged.guests.map((guest) => guest.id)),
    );

    const importedCount = merged.guests.filter((guest) => guest.origin !== 'manual').length;
    const lastImport = {
      at: new Date().toISOString(),
      importedCount,
      skippedWithoutPhone: input.skippedWithoutPhone,
    };
    await storage.putEvent({ ...event, lastImport, updatedAt: lastImport.at });

    return {
      status: 200,
      body: {
        ...lastImport,
        duplicateRowsMerged: merged.duplicateRowsMerged,
        skippedExistingPhones: merged.skippedExistingPhones,
        removedFromQueues,
      },
    };
  }),

  route('GET', '/events/:eventId/campaigns', async ({ params, storage }) => {
    await loadEvent(storage, params.eventId!);
    return { status: 200, body: { campaigns: await storage.listCampaigns(params.eventId!) } };
  }),

  route('POST', '/events/:eventId/campaigns', async ({ params, body, storage }) => {
    const event = await loadEvent(storage, params.eventId!);
    const input = parseCampaignInput(body);
    await assertQueueGuestsExist(storage, event.id, input.queue);

    const now = new Date().toISOString();
    const campaign: CampaignRecord = {
      id: newCampaignId(input.type),
      eventId: event.id,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    await storage.putCampaign(campaign);
    return { status: 201, body: { campaign } };
  }),

  route('GET', '/campaigns/:campaignId', async ({ params, storage }) => ({
    status: 200,
    body: { campaign: await loadCampaign(storage, params.campaignId!) },
  })),

  route('PUT', '/campaigns/:campaignId', async ({ params, body, storage }) => {
    const existing = await loadCampaign(storage, params.campaignId!);
    const patch = parseCampaignPatch(body);
    if (patch.queue) await assertQueueGuestsExist(storage, existing.eventId, patch.queue);

    const campaign: CampaignRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await storage.putCampaign(campaign);
    return { status: 200, body: { campaign } };
  }),

  /**
   * Set one guest's attempt limit, or clear it so they follow the campaign default again.
   * The campaign retry cap stays the default for every guest without an override.
   */
  route('PUT', '/campaigns/:campaignId/guests/:guestId/retry-cap', async ({ params, body, storage }) => {
    const existing = await loadCampaign(storage, params.campaignId!);
    const guest = await storage.getGuest(existing.eventId, params.guestId!);
    if (!guest) throw notFound(`guest not found on this event: ${params.guestId}`);

    const retryCap = parseGuestRetryCap(body);
    const retryCapOverrides = withGuestRetryCap(existing.retryCapOverrides, guest.id, retryCap);
    const campaign: CampaignRecord = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };
    if (retryCapOverrides) campaign.retryCapOverrides = retryCapOverrides;
    else delete campaign.retryCapOverrides;
    await storage.putCampaign(campaign);
    return { status: 200, body: { campaign } };
  }),

  /**
   * Call one guest. The number is read from storage by guest id and never taken
   * from the request, so a number that is not on the list can never be dialed.
   * This is a run with a queue of one, so it reports the same way as a full run.
   */
  route('POST', '/campaigns/:campaignId/calls', async ({ params, body, storage, services }) => {
    const calling = requireCalling(services);
    const campaign = await loadCampaign(storage, params.campaignId!);
    const { guestId, openQuestionId, waiveCallingWindow } = parseCallRequestInput(body);

    const guest = await storage.getGuest(campaign.eventId, guestId);
    if (!guest) throw notFound(`guest not found on this event: ${guestId}`);

    if (openQuestionId) await assertOpenQuestion(storage, campaign, guest.id, openQuestionId);

    const run = await startRun(calling, campaign, {
      kind: 'single',
      guestIds: [guest.id],
      waiveRetryCap: openQuestionId !== null,
      waiveCallingWindow,
    });
    return { status: 202, body: { run } };
  }),

  /**
   * Mark one saved question resolved. The record stays on the attempt.
   * Placing the follow-up call does not do this.
   */
  route(
    'POST',
    '/events/:eventId/attempts/:attemptId/questions/:questionId/resolve',
    async ({ params, storage }) => {
      const event = await loadEvent(storage, params.eventId!);
      const attempt = await storage.getAttempt(event.id, params.attemptId!);
      if (!attempt) throw notFound(`attempt not found: ${params.attemptId}`);

      const questionId = params.questionId!;
      if (!attempt.openQuestions.some((question) => question.id === questionId)) {
        throw notFound(`question not found: ${questionId}`);
      }

      const updated: AttemptRecord = {
        ...attempt,
        openQuestions: attempt.openQuestions.map((question) =>
          question.id === questionId ? { ...question, status: 'resolved' } : question,
        ),
      };
      await storage.putAttempt(updated);
      return { status: 200, body: { attempt: updated } };
    },
  ),

  /**
   * Start the campaign's saved queue now, or at `startsAt` if that field is set.
   * A scheduled run dials nothing until then, and stop cancels it.
   */
  route('POST', '/campaigns/:campaignId/runs', async ({ params, body, storage, services }) => {
    const calling = requireCalling(services);
    const campaign = await loadCampaign(storage, params.campaignId!);
    const { startsAt, waiveCallingWindow } = parseRunStartInput(body);
    const run = startsAt
      ? await scheduleRun(calling, campaign, new Date(startsAt), { waiveCallingWindow })
      : await startRun(calling, campaign, { kind: 'queue', waiveCallingWindow });
    return { status: 202, body: { run } };
  }),

  route('GET', '/runs/:runId', async ({ params, storage }) => {
    const run = await storage.findRun(params.runId!);
    if (!run) throw notFound(`run not found: ${params.runId}`);

    const attempts = await storage.listAttempts(run.eventId);
    return {
      status: 200,
      body: {
        run,
        attempts: attempts.filter((attempt) => attempt.runId === run.id),
      },
    };
  }),

  route('POST', '/runs/:runId/stop', async ({ params, services }) => {
    const calling = requireCalling(services);
    const run = await calling.runner.stopRun(params.runId!);
    if (!run) throw notFound(`run not found: ${params.runId}`);
    return { status: 200, body: { run } };
  }),

  route('GET', '/events/:eventId/runs', async ({ params, storage }) => {
    await loadEvent(storage, params.eventId!);
    return { status: 200, body: { runs: await storage.listRuns(params.eventId!) } };
  }),

  route('GET', '/events/:eventId/attempts', async ({ params, query, storage }) => {
    await loadEvent(storage, params.eventId!);
    const attempts = await storage.listAttempts(params.eventId!);
    const campaignId = query.get('campaignId');
    return {
      status: 200,
      body: {
        attempts: campaignId
          ? attempts.filter((attempt) => attempt.campaignId === campaignId)
          : attempts,
      },
    };
  }),

  route('GET', '/events/:eventId/summary', async ({ params, storage }) => {
    const event = await loadEvent(storage, params.eventId!);
    const [guests, campaigns, attempts] = await Promise.all([
      storage.listGuests(event.id),
      storage.listCampaigns(event.id),
      storage.listAttempts(event.id),
    ]);
    return { status: 200, body: { summary: buildSummary(event, guests, campaigns, attempts) } };
  }),
];

/**
 * A follow-up dial is allowed only for a question that is still open on this
 * guest and campaign. Anything else is an ordinary call and keeps the retry cap.
 */
async function assertOpenQuestion(
  storage: Storage,
  campaign: CampaignRecord,
  guestId: string,
  questionId: string,
): Promise<void> {
  const attempts = await storage.listAttempts(campaign.eventId);
  const open = attempts.some(
    (attempt) =>
      attempt.campaignId === campaign.id &&
      attempt.guestId === guestId &&
      attempt.openQuestions.some(
        (question) => question.id === questionId && question.status === 'open',
      ),
  );
  if (!open) throw badRequest('that question is not open for this guest');
}

/** A queue may only reference guests stored for that event (never a raw number). */
async function assertQueueGuestsExist(
  storage: Storage,
  eventId: string,
  queue: string[],
): Promise<void> {
  if (queue.length === 0) return;
  const known = new Set((await storage.listGuests(eventId)).map((guest) => guest.id));
  const unknown = queue.filter((guestId) => !known.has(guestId));
  if (unknown.length > 0) {
    throw new HttpError(400, `queue references unknown guests: ${unknown.slice(0, 5).join(', ')}`);
  }
}

/** Tally only settled attempts; a live call has no outcome yet. */
function tallyOutcomes(attempts: AttemptRecord[]): Record<CallOutcome, number> {
  return attempts.reduce((tally, attempt) => {
    if (attempt.outcome) tally[attempt.outcome] += 1;
    return tally;
  }, emptyOutcomeTally());
}

function countLive(attempts: AttemptRecord[]): number {
  return attempts.filter((attempt) => attempt.status !== 'done').length;
}

/** Per-campaign counts plus captured-value tallies, so results need no audio. */
function buildSummary(
  event: EventRecord,
  guests: GuestRecord[],
  campaigns: CampaignRecord[],
  attempts: AttemptRecord[],
) {
  return {
    eventId: event.id,
    guestCount: guests.length,
    attemptCount: attempts.length,
    liveCount: countLive(attempts),
    outcomes: tallyOutcomes(attempts),
    campaigns: campaigns.map((campaign) => {
      const mine = attempts.filter((attempt) => attempt.campaignId === campaign.id);
      const captured: Record<string, Record<string, number>> = {};
      for (const field of campaign.fields) {
        captured[field.key] = {};
        for (const attempt of mine) {
          if (attempt.status !== 'done') continue;
          const value = attempt.capturedFields[field.key] ?? 'unknown';
          const bucket = captured[field.key]!;
          bucket[value] = (bucket[value] ?? 0) + 1;
        }
      }
      return {
        campaignId: campaign.id,
        type: campaign.type,
        name: campaign.name,
        queued: campaign.queue.length,
        attempted: new Set(mine.map((attempt) => attempt.guestId)).size,
        liveCount: countLive(mine),
        outcomes: tallyOutcomes(mine),
        captured,
      };
    }),
  };
}

function matchRoute(method: string, pathSegments: string[]): { route: Route; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== pathSegments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, segment] of candidate.segments.entries()) {
      const actual = pathSegments[index]!;
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(actual);
      } else if (segment !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

/**
 * Wire the route table to a Node request listener. Telephony callbacks are
 * offered to the adapter first, because they are form-encoded, answered with
 * provider markup, and must stay provider-shaped inside that module.
 */
export function createRequestListener(storage: Storage, services?: ApiServices) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      if (services?.telephony.handleRequest(req, res, url)) return;

      const match = matchRoute(method, pathSegments);
      if (!match) throw notFound(`no route for ${method} ${url.pathname}`);

      const body = method === 'POST' || method === 'PUT' ? await readJsonBody(req) : {};
      const result = await match.route.handle({
        params: match.params,
        query: url.searchParams,
        body,
        storage,
        services,
      });
      sendJson(res, result.status, result.body ?? {});
    } catch (error) {
      sendError(res, error);
    }
  };
}

/** The call audio socket. Only the telephony provider ever reaches it. */
export function createUpgradeListener(services?: ApiServices) {
  return (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (services?.telephony.handleUpgrade(req, socket, head, url)) return;
    socket.destroy();
  };
}
