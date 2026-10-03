/**
 * Record shapes the server persists and the storage contract the API talks to.
 * Kept free of provider and product concepts so a database can replace the
 * JSON implementation later (DESIGN D4).
 */

/** Luma approval status values, plus `unknown` for anything we could not map. */
export type ApprovalStatus =
  | 'approved'
  | 'pending_approval'
  | 'invited'
  | 'waitlist'
  | 'declined'
  | 'unknown';

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'approved',
  'pending_approval',
  'invited',
  'waitlist',
  'declined',
  'unknown',
];

export type CampaignType = 'pre-event' | 'post-event';
export type Language = 'en' | 'hi';
export type VoiceBackend = 'elevenlabs' | 'cascaded';
export type CallOutcome =
  | 'answered'
  | 'no_answer'
  | 'voicemail'
  | 'declined'
  | 'hung_up'
  | 'failed';

export const CALL_OUTCOMES: readonly CallOutcome[] = [
  'answered',
  'no_answer',
  'voicemail',
  'declined',
  'hung_up',
  'failed',
];

/** How far an attempt got. `outcome` is only final once this leaves the live states. */
export type AttemptStatus = 'dialing' | 'in_call' | 'extracting' | 'done';

/** Lifecycle steps recorded per attempt, so results read without any audio. */
export type AttemptEventKind =
  | 'created'
  | 'dialing'
  | 'ringing'
  | 'answered'
  | 'machine_detected'
  | 'backend_started'
  | 'call_ended'
  | 'extraction_started'
  | 'extraction_done'
  | 'extraction_failed'
  | 'error'
  | 'interrupted';

export interface AttemptEvent {
  at: string;
  kind: AttemptEventKind;
  detail: string | null;
}

export type RunStatus =
  | 'scheduled'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'interrupted';

/** `queue` works the saved campaign queue; `single` is one guest on demand. */
export type RunKind = 'queue' | 'single';

/**
 * Where a pipeline test got its prompt. `builtin` is the global one-click
 * script. Master and campaign bodies are re-read when the call is answered.
 */
export type TestCallPromptSource =
  | { kind: 'builtin' }
  | { kind: 'master'; campaignType: CampaignType }
  | { kind: 'campaign'; campaignId: string }
  | { kind: 'custom'; prompt: string };

/** A guest the runner refused to dial, with the guardrail that refused them. */
export interface SkippedGuest {
  guestId: string;
  reason: string;
}

/** What the last guest import produced, so the organizer can see skip counts again. */
export interface ImportSummary {
  at: string;
  importedCount: number;
  skippedWithoutPhone: number;
}

/** Facts the agent may say. Empty strings mean the organizer has not written them. */
export interface EventBrief {
  /** What the event is, in a sentence or two. */
  about: string;
  /** Where it is, or that it is online. */
  where: string;
  /** Practical notes the organizer adds later. They outrank the description. */
  notes: string;
}

/** A brief with nothing filled in. */
export function emptyEventBrief(): EventBrief {
  return { about: '', where: '', notes: '' };
}

export interface EventRecord {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  /** What the call is allowed to tell the guest, besides the name and times. */
  brief: EventBrief;
  /** Canonical Luma page this event was filled from. Null when entered by hand. */
  sourceUrl: string | null;
  lastImport: ImportSummary | null;
  createdAt: string;
  updatedAt: string;
}

/** imported from a CSV. manual when the organizer typed the guest in. */
export type GuestOrigin = 'imported' | 'manual';

/** A guest the server will allow to be dialed. Stored only with a usable phone. */
export interface GuestRecord {
  id: string;
  sourceId: string | null;
  name: string;
  email: string | null;
  phone: string;
  approvalStatus: ApprovalStatus;
  ticketName: string | null;
  checkedInAt: string | null;
  registeredAt: string | null;
  attributes: Record<string, string>;
  /** Omitted on older files, which were all imports. */
  origin?: GuestOrigin;
}

/** One structured value a campaign wants captured from the conversation. */
export interface CaptureField {
  key: string;
  label: string;
  kind: 'text' | 'boolean' | 'enum';
  options?: string[];
}

export interface CallingWindow {
  start: string;
  end: string;
  timezone: string;
}

export interface CampaignRecord {
  id: string;
  eventId: string;
  type: CampaignType;
  name: string;
  /**
   * Custom prompt body. Used only when useMasterPrompt is false; otherwise the
   * org master prompt for this campaign type is what the call runs on.
   */
  prompt: string;
  /** When true (the default for new campaigns), the org master prompt wins. */
  useMasterPrompt: boolean;
  /**
   * One line added after the agent prompt. Empty on the usual campaigns.
   * Omitted on older files.
   */
  purpose?: string;
  language: Language;
  fields: CaptureField[];
  callingWindow: CallingWindow;
  retryCap: number;
  /**
   * Per-guest attempt limits. Guests missing from this map use retryCap,
   * the default for this campaign. Omitted when every guest follows that default.
   */
  retryCapOverrides?: Record<string, number>;
  voiceBackendOrder: VoiceBackend[];
  queue: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptTurn {
  role: 'agent' | 'guest';
  text: string;
  at: string;
}

/** A question the call could not answer, kept so a person can call the guest back. */
export interface OpenQuestion {
  id: string;
  /** The question in the guest's words. */
  text: string;
  status: 'open' | 'resolved';
}

export interface AttemptRecord {
  id: string;
  eventId: string;
  campaignId: string;
  guestId: string;
  runId: string | null;
  status: AttemptStatus;
  /** Null while the call is still live; set once the end reason is known. */
  outcome: CallOutcome | null;
  startedAt: string;
  endedAt: string | null;
  transcript: TranscriptTurn[];
  capturedFields: Record<string, string>;
  /** Questions the brief could not answer. Empty when the call was not a guest attempt. */
  openQuestions: OpenQuestion[];
  voiceBackend: VoiceBackend | null;
  fallbackUsed: boolean;
  /** Provider handles, kept for support questions about one specific call. */
  providerCallId: string | null;
  voiceSessionId: string | null;
  timeline: AttemptEvent[];
  error: string | null;
}

/**
 * One pass over a set of guests. A run is the unit the organizer starts and
 * stops, and it is persisted so a restart can never leave it looking live.
 */
export interface RunRecord {
  id: string;
  eventId: string;
  campaignId: string;
  kind: RunKind;
  status: RunStatus;
  /** Guest ids, in dial order, resolved when the run was created. */
  guestIds: string[];
  currentGuestId: string | null;
  currentAttemptId: string | null;
  attemptIds: string[];
  skipped: SkippedGuest[];
  /** When true, this run is a follow-up on an open question and skips the retry cap. */
  waiveRetryCap: boolean;
  /**
   * When true, the organizer double-confirmed dialing outside calling hours.
   * Event timing rules still apply.
   */
  waiveCallingWindow: boolean;
  /** When dialing should begin. Null when the organizer started the run immediately. */
  scheduledFor: string | null;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
}

/**
 * One pipeline test call. Stored outside event folders so guest results and
 * summaries never include it. `eventId` is null for a global test.
 */
export interface TestCallRecord {
  id: string;
  eventId: string | null;
  to: string;
  promptSource: TestCallPromptSource;
  language: Language;
  fields: CaptureField[];
  status: AttemptStatus;
  outcome: CallOutcome | null;
  startedAt: string;
  endedAt: string | null;
  transcript: TranscriptTurn[];
  capturedFields: Record<string, string>;
  voiceBackend: VoiceBackend | null;
  fallbackUsed: boolean;
  providerCallId: string | null;
  voiceSessionId: string | null;
  timeline: AttemptEvent[];
  error: string | null;
}

import type { OrgSettings } from './settings.ts';

/**
 * Persistence boundary. One writer, no concurrency: the server is the only
 * process that touches the data folder.
 */
export interface Storage {
  getSettings(): Promise<OrgSettings>;
  putSettings(settings: OrgSettings): Promise<void>;

  listEvents(): Promise<EventRecord[]>;
  getEvent(eventId: string): Promise<EventRecord | null>;
  putEvent(event: EventRecord): Promise<void>;

  listGuests(eventId: string): Promise<GuestRecord[]>;
  getGuest(eventId: string, guestId: string): Promise<GuestRecord | null>;
  replaceGuests(eventId: string, guests: GuestRecord[]): Promise<void>;

  listCampaigns(eventId: string): Promise<CampaignRecord[]>;
  getCampaign(eventId: string, campaignId: string): Promise<CampaignRecord | null>;
  findCampaign(campaignId: string): Promise<CampaignRecord | null>;
  putCampaign(campaign: CampaignRecord): Promise<void>;

  listAttempts(eventId: string): Promise<AttemptRecord[]>;
  getAttempt(eventId: string, attemptId: string): Promise<AttemptRecord | null>;
  putAttempt(attempt: AttemptRecord): Promise<void>;

  listRuns(eventId: string): Promise<RunRecord[]>;
  getRun(eventId: string, runId: string): Promise<RunRecord | null>;
  findRun(runId: string): Promise<RunRecord | null>;
  putRun(run: RunRecord): Promise<void>;

  /** Event ids, so startup reconciliation can sweep every folder once. */
  listEventIds(): Promise<string[]>;

  listTestCalls(eventId: string | null): Promise<TestCallRecord[]>;
  listAllTestCalls(): Promise<TestCallRecord[]>;
  getTestCall(id: string): Promise<TestCallRecord | null>;
  putTestCall(call: TestCallRecord): Promise<void>;
}
