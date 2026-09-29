/**
 * Read a public Luma event page once and turn it into the fields we store.
 * The call never fetches Luma itself; it uses the text saved here.
 */
import { HttpError } from '../api/http.ts';
import { newEventId } from '../storage/ids.ts';
import type { EventBrief, EventRecord, Storage } from '../storage/types.ts';

const LUMA_HOSTS = new Set(['lu.ma', 'www.lu.ma', 'luma.com', 'www.luma.com']);
const ABOUT_MAX = 8000;
const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const PAGE_MAX_BYTES = 2_000_000;

/** What a Luma page contributes. The place stays separate so the prompt can say it. */
export interface LumaDraft {
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  brief: EventBrief;
}

/** Fetches the HTML for a canonical Luma URL. Tests pass their own loader. */
export type LumaPageLoader = (url: string) => Promise<string>;

/**
 * One saved Luma link is one event. A second paste of the same page returns
 * the event already stored and does not fetch again.
 */
export async function importLumaEvent(
  storage: Storage,
  rawUrl: string,
  loadPage: LumaPageLoader = fetchLumaHtml,
): Promise<{ event: EventRecord; created: boolean }> {
  const sourceUrl = canonicalLumaUrl(rawUrl);
  const existing = (await storage.listEvents()).find((event) => event.sourceUrl === sourceUrl);
  if (existing) return { event: existing, created: false };

  const draft = parseLumaHtml(await loadPage(sourceUrl));
  const now = new Date().toISOString();
  const event: EventRecord = {
    id: newEventId(draft.name),
    name: draft.name,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    timezone: draft.timezone,
    brief: draft.brief,
    sourceUrl,
    lastImport: null,
    createdAt: now,
    updatedAt: now,
  };
  await storage.putEvent(event);
  return { event, created: true };
}

/**
 * Replace the name, schedule, and description from the page saved on the event.
 * The organizer's notes stay, because they are the newer private facts.
 * Guests and campaigns stay as they are.
 */
export async function refreshLumaEvent(
  storage: Storage,
  eventId: string,
  loadPage: LumaPageLoader = fetchLumaHtml,
): Promise<EventRecord> {
  const existing = await storage.getEvent(eventId);
  if (!existing) throw new HttpError(404, `event not found: ${eventId}`);
  if (!existing.sourceUrl) {
    throw new HttpError(400, 'This event has no Luma link to check.');
  }

  const draft = parseLumaHtml(await loadPage(existing.sourceUrl));
  const event: EventRecord = {
    ...existing,
    name: draft.name,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    timezone: draft.timezone,
    brief: {
      about: draft.brief.about,
      where: draft.brief.where,
      notes: existing.brief.notes,
    },
    updatedAt: new Date().toISOString(),
  };
  await storage.putEvent(event);
  return event;
}

/** lu.ma and luma.com, with or without a tracking query, are the same event. */
export function canonicalLumaUrl(input: string): string {
  let trimmed = input.trim();
  if (trimmed !== '' && !/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new HttpError(400, 'That is not a Luma link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, 'That is not a Luma link.');
  }
  const host = url.hostname.toLowerCase();
  if (!LUMA_HOSTS.has(host)) {
    throw new HttpError(400, 'That link is not a Luma event page.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!path || path === '/') {
    throw new HttpError(400, 'That Luma link has no event in it.');
  }
  return `https://luma.com${path}`;
}

/** Pull the event out of the page HTML. Prefers the embedded event JSON. */
export function parseLumaHtml(html: string): LumaDraft {
  const next = extractNextData(html);
  const fromNext = next ? draftFromNext(next) : null;
  if (fromNext) return fromNext;

  const fromLd = draftFromJsonLd(extractJsonLd(html));
  if (fromLd) return fromLd;

  throw new HttpError(400, 'That page did not include an event name and time. Enter the event yourself.');
}

/** Download a public Luma page. The response must still be on Luma. */
export async function fetchLumaHtml(url: string): Promise<string> {
  const target = canonicalLumaUrl(url);
  let response: Response;
  try {
    response = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'text/html',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
  } catch {
    throw new HttpError(502, 'Could not reach that Luma page. Check the link and try again.');
  }

  let finalHost = '';
  try {
    finalHost = new URL(response.url).hostname.toLowerCase();
  } catch {
    finalHost = '';
  }
  if (!LUMA_HOSTS.has(finalHost)) {
    throw new HttpError(502, 'That link left Luma before it could be read.');
  }
  if (!response.ok) {
    throw new HttpError(502, `Luma returned ${response.status}. Check the link and try again.`);
  }

  const html = await response.text();
  if (html.length > PAGE_MAX_BYTES) {
    throw new HttpError(400, 'That Luma page was too large to read. Enter the event yourself.');
  }
  return html;
}

function draftFromNext(root: unknown): LumaDraft | null {
  const data = dig(root, ['props', 'pageProps', 'initialData', 'data']);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const event = record.event;
    if (isEventRecord(event)) return draftFromEvent(event, record);
  }

  const events = collectEvents(root);
  if (events.length === 1) return draftFromEvent(events[0]!, null);
  if (events.length > 1) {
    throw new HttpError(400, 'Paste the link to one event, not a list of them.');
  }
  return null;
}

function draftFromEvent(event: Record<string, unknown>, parent: Record<string, unknown> | null): LumaDraft | null {
  const name = clip(plainText(event.name), 200);
  const startsAt = isoOrNull(event.start_at);
  if (!name || !startsAt) return null;

  const endsAt = isoOrNull(event.end_at) ?? new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000).toISOString();
  const end = new Date(endsAt) > new Date(startsAt) ? endsAt : new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000).toISOString();
  const about = clip(descriptionOf(event, parent), ABOUT_MAX);
  const where = clip(placeOf(event), 2000);

  return {
    name,
    startsAt,
    endsAt: end,
    timezone: timezoneOrDefault(event.timezone),
    brief: { about, where, notes: '' },
  };
}

function descriptionOf(event: Record<string, unknown>, parent: Record<string, unknown> | null): string {
  const own = plainText(event.description);
  if (own) return own;
  const mirror = proseToText(event.description_mirror).trim() || proseToText(parent?.description_mirror).trim();
  return mirror;
}

function placeOf(event: Record<string, unknown>): string {
  const kind = typeof event.location_type === 'string' ? event.location_type : '';
  const geo = event.geo_address_info ?? event.geo_address_json;
  const address =
    geo && typeof geo === 'object' && !Array.isArray(geo)
      ? firstString(
          (geo as Record<string, unknown>).full_address,
          (geo as Record<string, unknown>).address,
          (geo as Record<string, unknown>).short_address,
          (geo as Record<string, unknown>).city,
        )
      : '';
  if (kind === 'online' && !address) return 'Online';
  if (kind === 'online') return `Online (${address})`;
  return address;
}

function draftFromJsonLd(nodes: unknown[]): LumaDraft | null {
  for (const node of nodes) {
    for (const event of flattenLd(node)) {
      const types = event['@type'];
      const isEvent = types === 'Event' || (Array.isArray(types) && types.includes('Event'));
      if (!isEvent) continue;
      const name = clip(plainText(event.name), 200);
      const startsAt = isoOrNull(event.startDate);
      if (!name || !startsAt) continue;
      const endsAt = isoOrNull(event.endDate) ?? new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000).toISOString();
      const end = new Date(endsAt) > new Date(startsAt) ? endsAt : new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000).toISOString();
      return {
        name,
        startsAt,
        endsAt: end,
        timezone: DEFAULT_TIMEZONE,
        brief: {
          about: clip(plainText(event.description), ABOUT_MAX),
          where: clip(ldPlace(event.location), 2000),
          notes: '',
        },
      };
    }
  }
  return null;
}

function ldPlace(location: unknown): string {
  if (typeof location === 'string') return plainText(location);
  if (!location || typeof location !== 'object' || Array.isArray(location)) return '';
  const loc = location as Record<string, unknown>;
  if (loc['@type'] === 'VirtualLocation') return 'Online';
  if (typeof loc.address === 'string') return plainText(loc.address);
  if (loc.address && typeof loc.address === 'object' && !Array.isArray(loc.address)) {
    const address = loc.address as Record<string, unknown>;
    return [address.streetAddress, address.addressLocality, address.addressRegion]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(', ');
  }
  return plainText(loc.name);
}

function flattenLd(node: unknown): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((item) => flattenLd(item));
  const record = node as Record<string, unknown>;
  const graph = record['@graph'];
  if (Array.isArray(graph)) return graph.flatMap((item) => flattenLd(item));
  return [record];
}

function collectEvents(root: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  walk(root, (obj) => {
    if (typeof obj.api_id === 'string' && obj.api_id.startsWith('evt-') && isEventRecord(obj)) {
      found.push(obj);
    }
  });
  return found;
}

function isEventRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string' && typeof record.start_at === 'string';
}

function extractNextData(html: string): unknown | null {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return null;
  }
}

function extractJsonLd(html: string): unknown[] {
  const nodes: unknown[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    if (!match[1]) continue;
    try {
      nodes.push(JSON.parse(match[1]) as unknown);
    } catch {
      // A broken block is skipped; another script on the page may still parse.
    }
  }
  return nodes;
}

/** ProseMirror document from a Luma description, as plain paragraphs. */
function proseToText(node: unknown, depth = 0): string {
  if (!node || typeof node !== 'object' || depth > 40) return '';
  const record = node as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text;
  const children = Array.isArray(record.content) ? record.content : [];
  let text = children.map((child) => proseToText(child, depth + 1)).join('');
  const blocks = new Set(['paragraph', 'heading', 'blockquote', 'listItem', 'bulletList', 'orderedList', 'codeBlock']);
  if (typeof record.type === 'string' && blocks.has(record.type)) text = `${text.trim()}\n`;
  return text;
}

function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return decodeHtml(value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function dig(root: unknown, path: string[]): unknown {
  let current = root;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 30 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  visit(record);
  for (const value of Object.values(record)) walk(value, visit, depth + 1);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function timezoneOrDefault(value: unknown): string {
  if (typeof value !== 'string' || value.length > 60) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
