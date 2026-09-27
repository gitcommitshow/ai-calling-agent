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
} from '../domain/types';
import type { CampaignTemplate } from '../domain/campaign-templates';
import type { OrgSettings } from '../domain/settings';

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

export async function createEvent(input: {
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}): Promise<Event> {
  const body = JSON.stringify(input);
  return (await request<{ event: Event }>('/events', { method: 'POST', body })).event;
}

export async function listGuests(eventId: string): Promise<Guest[]> {
  return (await request<{ guests: Guest[] }>(`/events/${eventId}/guests`)).guests;
}

export interface ImportResult {
  importedCount: number;
  skippedWithoutPhone: number;
  duplicateRowsMerged: number;
  removedFromQueues: number;
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
 * Call one guest. The server reads the number from storage by id, so only a
 * guest on the list can be dialed. It answers with the run doing the calling.
 */
export async function callGuest(campaignId: string, guestId: string): Promise<Run> {
  return (
    await request<{ run: Run }>(`/campaigns/${campaignId}/calls`, {
      method: 'POST',
      body: JSON.stringify({ guestId }),
    })
  ).run;
}

/** Start the campaign's saved queue. The server allows one run at a time. */
export async function startRun(campaignId: string): Promise<Run> {
  return (await request<{ run: Run }>(`/campaigns/${campaignId}/runs`, { method: 'POST' })).run;
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

export async function getSettings(): Promise<OrgSettings> {
  return (await request<{ settings: OrgSettings }>('/settings')).settings;
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
