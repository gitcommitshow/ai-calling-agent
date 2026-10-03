/**
 * Domain shapes the organizer app works with. These mirror what the server
 * stores; the app keeps its own copy because the product rules live here and
 * are deliberately not shared as a library (DESIGN D5).
 */

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

/** Labels the organizer sees, matching Luma's own wording. */
export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  approved: 'Going',
  pending_approval: 'Pending',
  invited: 'Invited',
  waitlist: 'Waitlist',
  declined: 'Not going',
  unknown: 'Unmapped',
};

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

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  voicemail: 'Voicemail',
  declined: 'Declined',
  hung_up: 'Hung up',
  failed: 'Failed',
};

export type AttemptStatus = 'dialing' | 'in_call' | 'extracting' | 'done';

/** What the organizer reads while a call is still going. */
export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  dialing: 'Dialing',
  in_call: 'On the call',
  extracting: 'Reading the transcript',
  done: 'Finished',
};

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

export const ATTEMPT_EVENT_LABELS: Record<AttemptEventKind, string> = {
  created: 'Queued',
  dialing: 'Dialing',
  ringing: 'Ringing',
  answered: 'Answered',
  machine_detected: 'Answering machine',
  backend_started: 'Agent joined',
  call_ended: 'Call ended',
  extraction_started: 'Reading the transcript',
  extraction_done: 'Fields captured',
  extraction_failed: 'Could not capture fields',
  error: 'Error',
  interrupted: 'Interrupted',
};

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

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  scheduled: 'Scheduled',
  running: 'Running',
  stopping: 'Stopping',
  completed: 'Completed',
  stopped: 'Stopped',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

/** A run is live while these statuses hold, which is when the UI polls. */
export const LIVE_RUN_STATUSES: readonly RunStatus[] = ['running', 'stopping'];

export type RunKind = 'queue' | 'single';

/** Where a pipeline test got its prompt. Mirrors the server stored source. */
export type TestCallPromptSource =
  | { kind: 'builtin' }
  | { kind: 'master'; campaignType: CampaignType }
  | { kind: 'campaign'; campaignId: string }
  | { kind: 'custom'; prompt: string };

export interface SkippedGuest {
  guestId: string;
  reason: string;
}

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

export interface Event {
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

export interface Guest {
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
  /** Omitted on older lists, which were all imports. */
  origin?: GuestOrigin;
}

/** A guest as mapped from an upload, before the server assigns an id. */
export type GuestPayload = Omit<Guest, 'id'>;

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

export interface Campaign {
  id: string;
  eventId: string;
  type: CampaignType;
  name: string;
  /** Custom prompt body; used only when useMasterPrompt is false. */
  prompt: string;
  /** When true, the org master prompt for this campaign type wins. */
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

export interface Attempt {
  id: string;
  eventId: string;
  campaignId: string;
  guestId: string;
  runId: string | null;
  status: AttemptStatus;
  /** Null while the call is still live. */
  outcome: CallOutcome | null;
  startedAt: string;
  endedAt: string | null;
  transcript: TranscriptTurn[];
  capturedFields: Record<string, string>;
  /** Questions the brief could not answer. */
  openQuestions: OpenQuestion[];
  voiceBackend: VoiceBackend | null;
  fallbackUsed: boolean;
  providerCallId: string | null;
  voiceSessionId: string | null;
  timeline: AttemptEvent[];
  error: string | null;
}

/** One pass over a set of guests: what the organizer starts and stops. */
export interface Run {
  id: string;
  eventId: string;
  campaignId: string;
  kind: RunKind;
  status: RunStatus;
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

/** One pipeline test call, stored apart from guest attempts. */
export interface TestCall {
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

export interface CampaignSummary {
  campaignId: string;
  type: CampaignType;
  name: string;
  queued: number;
  attempted: number;
  liveCount: number;
  outcomes: Record<CallOutcome, number>;
  captured: Record<string, Record<string, number>>;
}

export interface EventSummary {
  eventId: string;
  guestCount: number;
  attemptCount: number;
  liveCount: number;
  outcomes: Record<CallOutcome, number>;
  campaigns: CampaignSummary[];
}
