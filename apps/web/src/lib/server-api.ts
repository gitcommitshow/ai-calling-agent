/**
 * Thin glue to the Node server's JSON API. Server-side only: the browser never
 * reaches the server directly, it goes through this app's route handlers.
 */
import type {
  Attempt,
  Campaign,
  Event,
  EventSummary,
  Guest,
  GuestPayload,
  Run,
  TestCall,
} from '../domain/types';
import type { CampaignTemplate } from '../domain/campaign-templates';
import type { CallingHoursMode, OrgSettings } from '../domain/settings';

const SERVER_URL = process.env.SERVER_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:4000';

/** Carries the server's status code so route handlers can pass it through. */
export class ServerApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ServerApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      cache: 'no-store',
    });
  } catch (cause) {
    throw new ServerApiError(
      502,
      `cannot reach the server at ${SERVER_URL}. Is "npm run dev -w apps/server" running?`,
      { cause },
    );
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ServerApiError(response.status, String(payload.error ?? response.statusText));
  }
  return payload as T;
}

export async function listEvents(): Promise<Event[]> {
  return (await request<{ events: Event[] }>('/events')).events;
}

export async function getEvent(eventId: string): Promise<Event> {
  return (await request<{ event: Event }>(`/events/${eventId}`)).event;
}

/** Create an event from a Luma page, or return the one already stored for that link. */
export async function importLumaEvent(url: string): Promise<{ event: Event; created: boolean }> {
  return request<{ event: Event; created: boolean }>('/events/from-luma', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

/** Re-read the saved Luma page and replace the name, schedule, and description. */
export async function refreshLumaEvent(eventId: string): Promise<Event> {
  return (await request<{ event: Event }>(`/events/${eventId}/refresh-luma`, { method: 'POST' })).event;
}

export async function createEvent(input: {
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  brief: Event['brief'];
}): Promise<Event> {
  const body = JSON.stringify(input);
  return (await request<{ event: Event }>('/events', { method: 'POST', body })).event;
}

/** Add one guest the organizer typed in. The server refuses a phone already on the list. */
export async function addGuest(
  eventId: string,
  input: { name: string; phone: string },
): Promise<Guest> {
  return (
    await request<{ guest: Guest }>(`/events/${eventId}/guests`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  ).guest;
}

export async function listGuests(eventId: string): Promise<Guest[]> {
  return (await request<{ guests: Guest[] }>(`/events/${eventId}/guests`)).guests;
}

export interface SkippedPhone {
  phone: string;
  existingName: string;
  incomingName: string;
}

export interface ImportResult {
  importedCount: number;
  skippedWithoutPhone: number;
  duplicateRowsMerged: number;
  removedFromQueues: number;
  skippedExistingPhones: SkippedPhone[];
}

export async function importGuests(
  eventId: string,
  payload: { guests: GuestPayload[]; skippedWithoutPhone: number },
): Promise<ImportResult> {
  return request<ImportResult>(`/events/${eventId}/guests/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listCampaigns(eventId: string): Promise<Campaign[]> {
  return (await request<{ campaigns: Campaign[] }>(`/events/${eventId}/campaigns`)).campaigns;
}

export async function createCampaign(
  eventId: string,
  template: CampaignTemplate,
): Promise<Campaign> {
  return (
    await request<{ campaign: Campaign }>(`/events/${eventId}/campaigns`, {
      method: 'POST',
      body: JSON.stringify(template),
    })
  ).campaign;
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  return (await request<{ campaign: Campaign }>(`/campaigns/${campaignId}`)).campaign;
}

export async function updateCampaign(
  campaignId: string,
  patch: Partial<Omit<Campaign, 'id' | 'eventId' | 'type' | 'createdAt' | 'updatedAt'>>,
): Promise<Campaign> {
  return (
    await request<{ campaign: Campaign }>(`/campaigns/${campaignId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
  ).campaign;
}

/**
 * Set one guest's attempt limit. Null clears it so the guest follows the
 * campaign default again.
 */
export async function setGuestRetryCap(
  campaignId: string,
  guestId: string,
  retryCap: number | null,
): Promise<Campaign> {
  return (
    await request<{ campaign: Campaign }>(
      `/campaigns/${campaignId}/guests/${encodeURIComponent(guestId)}/retry-cap`,
      {
        method: 'PUT',
        body: JSON.stringify({ retryCap }),
      },
    )
  ).campaign;
}

/** Replace the event details, including the brief the agent may say. */
export async function updateEvent(
  eventId: string,
  input: {
    name: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    brief: Event['brief'];
  },
): Promise<Event> {
  return (
    await request<{ event: Event }>(`/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  ).event;
}

/**
 * Call one guest. The server reads the number from storage by id, so only a
 * guest on the list can be dialed. An open question id makes this a follow-up
 * that skips the retry cap. `waiveCallingWindow` is only for a confirmed
 * outside-hours override. It answers with the run doing the calling.
 */
export async function callGuest(
  campaignId: string,
  guestId: string,
  options?: { openQuestionId?: string; waiveCallingWindow?: boolean },
): Promise<Run> {
  const openQuestionId = options?.openQuestionId;
  return (
    await request<{ run: Run }>(`/campaigns/${campaignId}/calls`, {
      method: 'POST',
      body: JSON.stringify({
        guestId,
        ...(openQuestionId ? { openQuestionId } : {}),
        ...(options?.waiveCallingWindow ? { waiveCallingWindow: true } : {}),
      }),
    })
  ).run;
}

/** Mark one saved question resolved. The question stays on the attempt. */
export async function resolveOpenQuestion(
  eventId: string,
  attemptId: string,
  questionId: string,
): Promise<Attempt> {
  return (
    await request<{ attempt: Attempt }>(
      `/events/${eventId}/attempts/${attemptId}/questions/${questionId}/resolve`,
      { method: 'POST' },
    )
  ).attempt;
}

/**
 * Start the campaign's saved queue. Pass `startsAt` to dial later instead of
 * now. `waiveCallingWindow` is only for a confirmed outside-hours override.
 * The server allows one live call at a time, and one scheduled start.
 */
export async function startRun(
  campaignId: string,
  options?: { startsAt?: string; waiveCallingWindow?: boolean },
): Promise<Run> {
  return (
    await request<{ run: Run }>(`/campaigns/${campaignId}/runs`, {
      method: 'POST',
      body: JSON.stringify({
        ...(options?.startsAt ? { startsAt: options.startsAt } : {}),
        ...(options?.waiveCallingWindow ? { waiveCallingWindow: true } : {}),
      }),
    })
  ).run;
}

export async function getRun(runId: string): Promise<{ run: Run; attempts: Attempt[] }> {
  return request<{ run: Run; attempts: Attempt[] }>(`/runs/${runId}`);
}

export async function stopRun(runId: string): Promise<Run> {
  return (await request<{ run: Run }>(`/runs/${runId}/stop`, { method: 'POST' })).run;
}

export async function listRuns(eventId: string): Promise<Run[]> {
  return (await request<{ runs: Run[] }>(`/events/${eventId}/runs`)).runs;
}

export async function listAttempts(eventId: string): Promise<Attempt[]> {
  return (await request<{ attempts: Attempt[] }>(`/events/${eventId}/attempts`)).attempts;
}

export async function getSummary(eventId: string): Promise<EventSummary> {
  return (await request<{ summary: EventSummary }>(`/events/${eventId}/summary`)).summary;
}

/** Org settings plus the server's calling-hours mode, which is not stored. */
export async function loadSettings(): Promise<{
  settings: OrgSettings;
  callingHoursMode: CallingHoursMode;
}> {
  const body = await request<{ settings: OrgSettings; callingHoursMode?: string }>('/settings');
  return {
    settings: body.settings,
    callingHoursMode: body.callingHoursMode === 'strict' ? 'strict' : 'soft',
  };
}

export async function getSettings(): Promise<OrgSettings> {
  return (await loadSettings()).settings;
}

export async function updateSettings(
  patch: Omit<OrgSettings, 'updatedAt'>,
): Promise<OrgSettings> {
  return (
    await request<{ settings: OrgSettings }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
  ).settings;
}

export type TestCallPromptSourceInput =
  | { kind: 'default' }
  | { kind: 'master'; campaignType: 'pre-event' | 'post-event' }
  | { kind: 'campaign'; campaignId: string }
  | { kind: 'custom'; prompt: string };

/** List pipeline tests for one scope. Omit eventId for global tests only. */
export async function listTestCalls(eventId?: string): Promise<TestCall[]> {
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
  return (await request<{ testCalls: TestCall[] }>(`/test-calls${query}`)).testCalls;
}

/** Place a pipeline test. Returns immediately; the call runs in the background. */
export async function startTestCall(input: {
  eventId?: string;
  to?: string;
  promptSource?: TestCallPromptSourceInput;
}): Promise<TestCall> {
  return (
    await request<{ testCall: TestCall }>('/test-calls', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  ).testCall;
}

/** Hang up a live pipeline test. */
export async function stopTestCall(id: string): Promise<TestCall> {
  return (await request<{ testCall: TestCall }>(`/test-calls/${id}/stop`, { method: 'POST' })).testCall;
}
