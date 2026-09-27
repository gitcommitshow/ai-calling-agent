/**
 * The JSON HTTP API for the web app. Routes validate, persist, and read back.
 * Product rules (filtering, ordering, eligibility, prompt text) stay in the web
 * app; this layer only guards the data.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { HttpError, notFound, readJsonBody, sendError, sendJson } from './http.ts';
import {
  parseCallRequestInput,
  parseCampaignInput,
  parseCampaignPatch,
  parseEventInput,
  parseGuestImportInput,
  parseOrgSettingsInput,
} from './validate.ts';
import { guestIdFor, newCampaignId, newEventId } from '../storage/ids.ts';
import { CALL_OUTCOMES } from '../storage/types.ts';
import type {
  AttemptRecord,
  CallOutcome,
  CampaignRecord,
  EventRecord,
  GuestRecord,
  RunRecord,
  Storage,
} from '../storage/types.ts';
import { GuardrailError, RunConflictError, type CallRunner } from '../runner/runner.ts';
import type { TelephonyPort } from '../telephony/types.ts';

/**
 * What the API needs beyond storage to place calls. Left optional so the data
 * and campaign endpoints still serve when no provider is configured.
 */
export interface ApiServices {
  runner: CallRunner;
  telephony: TelephonyPort;
  /** Variables still unset before a real call can be placed, if any. */
  missingConfig?: () => string[];
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

/** Turn a runner refusal into the status the organizer's UI expects. */
async function startRun(
  services: ApiServices,
  campaign: CampaignRecord,
  options: { kind: 'queue' | 'single'; guestIds?: string[] },
): Promise<RunRecord> {
  try {
    return await services.runner.startRun(campaign, options);
  } catch (error) {
    if (error instanceof RunConflictError) throw new HttpError(409, error.message);
    if (error instanceof GuardrailError) throw new HttpError(400, error.message);
    throw error;
  }
}

/** Drop queue entries whose guest is no longer on the list after an import. */
async function pruneQueues(storage: Storage, eventId: string, guestIds: Set<string>): Promise<number> {
  let removed = 0;
  for (const campaign of await storage.listCampaigns(eventId)) {
    const queue = campaign.queue.filter((guestId) => guestIds.has(guestId));
    if (queue.length === campaign.queue.length) continue;
    removed += campaign.queue.length - queue.length;
    await storage.putCampaign({ ...campaign, queue, updatedAt: new Date().toISOString() });
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

  route('GET', '/settings', async ({ storage }) => ({
    status: 200,
    body: { settings: await storage.getSettings() },
  })),

  route('PUT', '/settings', async ({ body, storage }) => {
    const input = parseOrgSettingsInput(body);
    const settings = { ...input, updatedAt: new Date().toISOString() };
    await storage.putSettings(settings);
    return { status: 200, body: { settings } };
  }),

  route('GET', '/events', async ({ storage }) => ({
    status: 200,
    body: { events: await storage.listEvents() },
  })),

  route('POST', '/events', async ({ body, storage }) => {
    const input = parseEventInput(body);
    const now = new Date().toISOString();
    const event: EventRecord = {
      id: newEventId(input.name),
      name: input.name,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
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
      updatedAt: new Date().toISOString(),
    };
    await storage.putEvent(event);
    return { status: 200, body: { event } };
  }),

  route('GET', '/events/:eventId/guests', async ({ params, storage }) => {
    await loadEvent(storage, params.eventId!);
    return { status: 200, body: { guests: await storage.listGuests(params.eventId!) } };
  }),

  route('POST', '/events/:eventId/guests/import', async ({ params, body, storage }) => {
    const event = await loadEvent(storage, params.eventId!);
    const input = parseGuestImportInput(body);

    const byId = new Map<string, GuestRecord>();
    for (const guest of input.guests) {
      const id = guestIdFor(guest);
      byId.set(id, { id, ...guest });
    }
    const guests = [...byId.values()];
    await storage.replaceGuests(event.id, guests);
    const removedFromQueues = await pruneQueues(storage, event.id, new Set(byId.keys()));

    const lastImport = {
      at: new Date().toISOString(),
      importedCount: guests.length,
      skippedWithoutPhone: input.skippedWithoutPhone,
    };
    await storage.putEvent({ ...event, lastImport, updatedAt: lastImport.at });

    return {
      status: 200,
      body: {
        ...lastImport,
        duplicateRowsMerged: input.guests.length - guests.length,
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
   * Call one guest. The number is read from storage by guest id and never taken
   * from the request, so a number that is not on the list can never be dialed.
   * This is a run with a queue of one, so it reports the same way as a full run.
   */
  route('POST', '/campaigns/:campaignId/calls', async ({ params, body, storage, services }) => {
    const calling = requireCalling(services);
    const campaign = await loadCampaign(storage, params.campaignId!);
    const { guestId } = parseCallRequestInput(body);

    const guest = await storage.getGuest(campaign.eventId, guestId);
    if (!guest) throw notFound(`guest not found on this event: ${guestId}`);

    const run = await startRun(calling, campaign, { kind: 'single', guestIds: [guest.id] });
    return { status: 202, body: { run } };
  }),

  /** Start the campaign's saved queue. One run at a time, one call at a time. */
  route('POST', '/campaigns/:campaignId/runs', async ({ params, storage, services }) => {
    const calling = requireCalling(services);
    const campaign = await loadCampaign(storage, params.campaignId!);

    const run = await startRun(calling, campaign, { kind: 'queue' });
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
