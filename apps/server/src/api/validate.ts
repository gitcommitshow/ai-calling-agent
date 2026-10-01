/**
 * Request validation. The server accepts nothing it has not checked: the web
 * app owns product rules, but persistence only ever sees well-formed records.
 */
import { badRequest } from './http.ts';
import { MAX_GUEST_ATTEMPTS } from '../runner/retry-cap.ts';
import {
  CONTEXT_FIELD_IDS,
  isContextFieldId,
  type ContextFieldId,
  type OrgSettings,
} from '../storage/settings.ts';
import { APPROVAL_STATUSES } from '../storage/types.ts';
import type {
  ApprovalStatus,
  CallingWindow,
  CampaignType,
  CaptureField,
  EventBrief,
  Language,
  VoiceBackend,
} from '../storage/types.ts';

const E164 = /^\+[1-9]\d{7,14}$/;
const INDIAN_MOBILE_E164 = /^\+91[6-9]\d{9}$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

export interface GuestInput {
  sourceId: string | null;
  name: string;
  email: string | null;
  phone: string;
  approvalStatus: ApprovalStatus;
  ticketName: string | null;
  checkedInAt: string | null;
  registeredAt: string | null;
  attributes: Record<string, string>;
}

export interface GuestImportInput {
  guests: GuestInput[];
  skippedWithoutPhone: number;
}

export interface EventInput {
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  brief: EventBrief;
}

export interface CampaignInput {
  type: CampaignType;
  name: string;
  prompt: string;
  useMasterPrompt: boolean;
  purpose: string;
  language: Language;
  fields: CaptureField[];
  callingWindow: CallingWindow;
  retryCap: number;
  voiceBackendOrder: VoiceBackend[];
  queue: string[];
}

export type CampaignPatch = Partial<Omit<CampaignInput, 'type'>>;

export interface CallRequestInput {
  guestId: string;
  /** Set when this dial answers a saved question. Null for an ordinary call. */
  openQuestionId: string | null;
  /** True only after the organizer double-confirmed outside calling hours. */
  waiveCallingWindow: boolean;
}

/** Prompt choice on a test-call request before the server resolves defaults. */
export type TestCallPromptSourceInput =
  | { kind: 'default' }
  | { kind: 'master'; campaignType: CampaignType }
  | { kind: 'campaign'; campaignId: string }
  | { kind: 'custom'; prompt: string };

export interface TestCallRequestInput {
  eventId: string | null;
  to: string | null;
  promptSource: TestCallPromptSourceInput;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, what: string, maxLength = 2000): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${what} is required`);
  }
  if (value.length > maxLength) throw badRequest(`${what} is too long`);
  return value.trim();
}

function optionalString(value: unknown, what: string, maxLength = 2000): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${what} must be a string`);
  if (value.length > maxLength) throw badRequest(`${what} is too long`);
  return value.trim();
}

/** A brief line may be empty. A non-string is refused. */
function briefField(value: unknown, what: string, maxLength: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw badRequest(`${what} must be a string`);
  if (value.length > maxLength) throw badRequest(`${what} is too long`);
  return value.trim();
}

/** Facts the agent may say. Omitted means an empty brief. */
function parseBrief(value: unknown): EventBrief {
  if (value === undefined || value === null) return { about: '', where: '', notes: '' };
  const record = asRecord(value, 'brief');
  return {
    about: briefField(record.about, 'brief.about', 8000),
    where: briefField(record.where, 'brief.where', 2000),
    notes: briefField(record.notes, 'brief.notes', 4000),
  };
}

function requireIsoDate(value: unknown, what: string): string {
  const text = requireString(value, what, 40);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw badRequest(`${what} must be an ISO date-time`);
  return date.toISOString();
}

function optionalIsoDate(value: unknown, what: string): string | null {
  const text = optionalString(value, what, 40);
  if (text === null) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw badRequest(`${what} must be an ISO date-time`);
  return date.toISOString();
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badRequest(`${what} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function requireArray(value: unknown, what: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) throw badRequest(`${what} must be an array`);
  if (value.length > maxLength) throw badRequest(`${what} has too many items`);
  return value;
}

function requireTimezone(value: unknown): string {
  const text = optionalString(value, 'timezone', 60) ?? 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: text });
  } catch {
    throw badRequest(`timezone is not recognized: ${text}`);
  }
  return text;
}

function parseAttributes(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  const record = asRecord(value, 'attributes');
  const attributes: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'string') throw badRequest(`attribute ${key} must be a string`);
    attributes[key.slice(0, 80)] = raw.slice(0, 2000);
  }
  return attributes;
}

export function parseEventInput(body: unknown): EventInput {
  const record = asRecord(body, 'event');
  const startsAt = requireIsoDate(record.startsAt, 'startsAt');
  const endsAt = requireIsoDate(record.endsAt, 'endsAt');
  if (new Date(endsAt) <= new Date(startsAt)) {
    throw badRequest('endsAt must be after startsAt');
  }
  return {
    name: requireString(record.name, 'name', 200),
    startsAt,
    endsAt,
    timezone: requireTimezone(record.timezone),
    brief: parseBrief(record.brief),
  };
}

/** A guest typed in by the organizer. Any E.164 number is stored. Calling is still India-only. */
export function parseManualGuestInput(body: unknown): { name: string; phone: string } {
  const record = asRecord(body, 'guest');
  const phone = requireString(record.phone, 'phone', 20);
  if (!E164.test(phone)) {
    throw badRequest('phone must be a full number with a country code, in E.164 form');
  }
  return {
    name: requireString(record.name, 'name', 200),
    phone,
  };
}

/** Guests arrive already mapped by the web app; the phone is re-checked here. */
export function parseGuestImportInput(body: unknown): GuestImportInput {
  const record = asRecord(body, 'import');
  const rows = requireArray(record.guests, 'guests', 20000);
  const guests = rows.map((row, index) => {
    const guest = asRecord(row, `guests[${index}]`);
    const phone = requireString(guest.phone, `guests[${index}].phone`, 20);
    if (!E164.test(phone)) {
      throw badRequest(`guests[${index}].phone must be in E.164 form, got ${phone}`);
    }
    return {
      sourceId: optionalString(guest.sourceId, 'sourceId', 120),
      name: optionalString(guest.name, 'name', 200) ?? 'Unknown guest',
      email: optionalString(guest.email, 'email', 200),
      phone,
      approvalStatus: requireOneOf(
        guest.approvalStatus ?? 'unknown',
        APPROVAL_STATUSES,
        `guests[${index}].approvalStatus`,
      ),
      ticketName: optionalString(guest.ticketName, 'ticketName', 200),
      checkedInAt: optionalIsoDate(guest.checkedInAt, 'checkedInAt'),
      registeredAt: optionalIsoDate(guest.registeredAt, 'registeredAt'),
      attributes: parseAttributes(guest.attributes),
    } satisfies GuestInput;
  });

  const skipped = record.skippedWithoutPhone ?? 0;
  if (typeof skipped !== 'number' || !Number.isInteger(skipped) || skipped < 0) {
    throw badRequest('skippedWithoutPhone must be a non-negative integer');
  }
  return { guests, skippedWithoutPhone: skipped };
}

function parseFields(value: unknown): CaptureField[] {
  const rows = requireArray(value, 'fields', 30);
  return rows.map((row, index) => {
    const field = asRecord(row, `fields[${index}]`);
    const key = requireString(field.key, `fields[${index}].key`, 40);
    if (!FIELD_KEY.test(key)) {
      throw badRequest(`fields[${index}].key must be snake_case, got ${key}`);
    }
    const kind = requireOneOf(field.kind, ['text', 'boolean', 'enum'] as const, `fields[${index}].kind`);
    const parsed: CaptureField = {
      key,
      label: requireString(field.label, `fields[${index}].label`, 200),
      kind,
    };
    if (kind === 'enum') {
      const options = requireArray(field.options, `fields[${index}].options`, 20).map(
        (option, optionIndex) =>
          requireString(option, `fields[${index}].options[${optionIndex}]`, 80),
      );
      if (options.length === 0) throw badRequest(`fields[${index}].options cannot be empty`);
      parsed.options = options;
    }
    return parsed;
  });
}

function parseCallingWindow(value: unknown): CallingWindow {
  const record = asRecord(value, 'callingWindow');
  const start = requireString(record.start, 'callingWindow.start', 5);
  const end = requireString(record.end, 'callingWindow.end', 5);
  if (!CLOCK_TIME.test(start) || !CLOCK_TIME.test(end)) {
    throw badRequest('callingWindow times must be HH:MM');
  }
  if (start >= end) throw badRequest('callingWindow.start must be before callingWindow.end');
  return { start, end, timezone: requireTimezone(record.timezone) };
}

function parseRetryCap(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_GUEST_ATTEMPTS
  ) {
    throw badRequest(`retryCap must be an integer between 1 and ${MAX_GUEST_ATTEMPTS}`);
  }
  return value;
}

/** One guest's attempt limit, or null to follow the campaign default again. */
export function parseGuestRetryCap(body: unknown): number | null {
  const record = asRecord(body, 'retry cap');
  if (!('retryCap' in record)) throw badRequest('retryCap is required');
  if (record.retryCap === null) return null;
  return parseRetryCap(record.retryCap);
}

/** Whole seconds for org call limits, within a named range. */
function parsePositiveSeconds(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${what} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseBackendOrder(value: unknown): VoiceBackend[] {
  const rows = requireArray(value, 'voiceBackendOrder', 5);
  if (rows.length === 0) throw badRequest('voiceBackendOrder cannot be empty');
  const order = rows.map((row, index) =>
    requireOneOf(row, ['elevenlabs', 'cascaded'] as const, `voiceBackendOrder[${index}]`),
  );
  if (new Set(order).size !== order.length) {
    throw badRequest('voiceBackendOrder cannot repeat a backend');
  }
  return order;
}

function parseQueue(value: unknown): string[] {
  const rows = requireArray(value, 'queue', 20000);
  const queue = rows.map((row, index) => requireString(row, `queue[${index}]`, 120));
  if (new Set(queue).size !== queue.length) throw badRequest('queue cannot repeat a guest');
  return queue;
}

/** Empty when the campaign uses the agent prompt with nothing added. */
function parsePurpose(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return requireString(value, 'purpose', 500);
}

function parseBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw badRequest(`${what} must be a boolean`);
  return value;
}

/** Indian mobile in E.164. Pipeline tests are the only request that may send a number. */
function parseIndianMobile(value: unknown, what: string): string {
  const text = requireString(value, what, 16);
  if (!INDIAN_MOBILE_E164.test(text)) {
    throw badRequest(`${what} must be an Indian mobile in +91 E.164 form`);
  }
  return text;
}

function parseOptionalIndianMobile(value: unknown, what: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return parseIndianMobile(value, what);
}

export function parseCampaignInput(body: unknown): CampaignInput {
  const record = asRecord(body, 'campaign');
  return {
    type: requireOneOf(record.type, ['pre-event', 'post-event'] as const, 'type'),
    name: requireString(record.name, 'name', 200),
    prompt: requireString(record.prompt, 'prompt', 20000),
    useMasterPrompt: parseBoolean(record.useMasterPrompt ?? true, 'useMasterPrompt'),
    purpose: parsePurpose(record.purpose),
    language: requireOneOf(record.language, ['en', 'hi'] as const, 'language'),
    fields: parseFields(record.fields ?? []),
    callingWindow: parseCallingWindow(
      record.callingWindow ?? { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
    ),
    retryCap: parseRetryCap(record.retryCap ?? 1),
    voiceBackendOrder: parseBackendOrder(record.voiceBackendOrder ?? ['elevenlabs', 'cascaded']),
    queue: parseQueue(record.queue ?? []),
  };
}

/** Only the keys present in the body are changed; campaign type is immutable. */
export function parseCampaignPatch(body: unknown): CampaignPatch {
  const record = asRecord(body, 'campaign');
  const patch: CampaignPatch = {};
  if ('name' in record) patch.name = requireString(record.name, 'name', 200);
  if ('prompt' in record) patch.prompt = requireString(record.prompt, 'prompt', 20000);
  if ('useMasterPrompt' in record) {
    patch.useMasterPrompt = parseBoolean(record.useMasterPrompt, 'useMasterPrompt');
  }
  if ('purpose' in record) patch.purpose = parsePurpose(record.purpose);
  if ('language' in record) {
    patch.language = requireOneOf(record.language, ['en', 'hi'] as const, 'language');
  }
  if ('fields' in record) patch.fields = parseFields(record.fields);
  if ('callingWindow' in record) patch.callingWindow = parseCallingWindow(record.callingWindow);
  if ('retryCap' in record) patch.retryCap = parseRetryCap(record.retryCap);
  if ('voiceBackendOrder' in record) {
    patch.voiceBackendOrder = parseBackendOrder(record.voiceBackendOrder);
  }
  if ('queue' in record) patch.queue = parseQueue(record.queue);
  if (Object.keys(patch).length === 0) throw badRequest('nothing to update');
  return patch;
}

/** Validate a full settings put. Master prompts and the context allowlist are required. */
export function parseOrgSettingsInput(body: unknown): Omit<OrgSettings, 'updatedAt'> {
  const record = asRecord(body, 'settings');
  const prompts = asRecord(record.masterPrompts, 'masterPrompts');
  const contextRows = requireArray(record.contextFields, 'contextFields', CONTEXT_FIELD_IDS.length);
  const contextFields: ContextFieldId[] = [];
  for (const [index, row] of contextRows.entries()) {
    if (typeof row !== 'string' || !isContextFieldId(row)) {
      throw badRequest(
        `contextFields[${index}] must be one of: ${CONTEXT_FIELD_IDS.join(', ')}`,
      );
    }
    if (!contextFields.includes(row)) contextFields.push(row);
  }

  return {
    masterPrompts: {
      'pre-event': requireString(prompts['pre-event'], 'masterPrompts.pre-event', 20000),
      'post-event': requireString(prompts['post-event'], 'masterPrompts.post-event', 20000),
    },
    contextFields,
    testNumber: parseOptionalIndianMobile(record.testNumber, 'testNumber'),
    callingWindow: parseCallingWindow(
      record.callingWindow ?? { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
    ),
    retryCap: parseRetryCap(record.retryCap ?? 1),
    silenceSeconds: parsePositiveSeconds(record.silenceSeconds, 'silenceSeconds', 5, 600),
    maxCallSeconds: parsePositiveSeconds(record.maxCallSeconds, 'maxCallSeconds', 30, 3600),
    dialTimeoutSeconds: parsePositiveSeconds(
      record.dialTimeoutSeconds,
      'dialTimeoutSeconds',
      10,
      180,
    ),
  };
}

/**
 * A queue run starts now, unless `startsAt` names a later instant. An empty
 * body is an immediate start. `waiveCallingWindow` is only for a confirmed
 * override of daily calling hours.
 */
export function parseRunStartInput(body: unknown): {
  startsAt: string | null;
  waiveCallingWindow: boolean;
} {
  if (body === undefined || body === null) {
    return { startsAt: null, waiveCallingWindow: false };
  }
  const record = asRecord(body, 'run');
  const waiveCallingWindow =
    record.waiveCallingWindow === undefined
      ? false
      : parseBoolean(record.waiveCallingWindow, 'waiveCallingWindow');
  if (record.startsAt === undefined || record.startsAt === null || record.startsAt === '') {
    return { startsAt: null, waiveCallingWindow };
  }
  return { startsAt: requireIsoDate(record.startsAt, 'startsAt'), waiveCallingWindow };
}

/** A call request names a guest id only. The number always comes from storage. */
export function parseCallRequestInput(body: unknown): CallRequestInput {
  const record = asRecord(body, 'call request');
  return {
    guestId: requireString(record.guestId, 'guestId', 120),
    openQuestionId: optionalString(record.openQuestionId, 'openQuestionId', 80),
    waiveCallingWindow:
      record.waiveCallingWindow === undefined
        ? false
        : parseBoolean(record.waiveCallingWindow, 'waiveCallingWindow'),
  };
}

/** Parse a pipeline test request. Omitted `to` means the saved test number. */
export function parseTestCallRequestInput(body: unknown): TestCallRequestInput {
  const record = asRecord(body, 'test call');
  return {
    eventId: optionalString(record.eventId, 'eventId', 120),
    to: parseOptionalIndianMobile(record.to, 'to'),
    promptSource: parseTestCallPromptSource(record.promptSource),
  };
}

function parseTestCallPromptSource(value: unknown): TestCallPromptSourceInput {
  if (value === undefined || value === null) return { kind: 'default' };
  const record = asRecord(value, 'promptSource');
  const kind = requireOneOf(
    record.kind,
    ['default', 'master', 'campaign', 'custom'] as const,
    'promptSource.kind',
  );
  if (kind === 'default') return { kind: 'default' };
  if (kind === 'master') {
    return {
      kind: 'master',
      campaignType: requireOneOf(
        record.campaignType,
        ['pre-event', 'post-event'] as const,
        'promptSource.campaignType',
      ),
    };
  }
  if (kind === 'campaign') {
    return { kind: 'campaign', campaignId: requireString(record.campaignId, 'promptSource.campaignId', 120) };
  }
  return { kind: 'custom', prompt: requireString(record.prompt, 'promptSource.prompt', 20000) };
}

