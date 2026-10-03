/**
 * Development seed data. Writes one upcoming event (for queue and eligibility
 * work) and one finished event with attempts (so the results page has something
 * to render before calling exists). Numbers are fake; nothing here is dialed.
 *
 * Run with: npm run seed --workspace apps/server
 */
import { newAttemptId, newCampaignId, newEventId, newRunId, guestIdFor } from './storage/ids.ts';
import { JsonStore } from './storage/json-store.ts';
import { loadConfig } from './config.ts';
import type {
  ApprovalStatus,
  AttemptRecord,
  CallOutcome,
  CampaignRecord,
  CampaignType,
  EventRecord,
  GuestRecord,
  RunRecord,
  VoiceBackend,
} from './storage/types.ts';

const WINDOW = { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' };
const BACKEND_ORDER: VoiceBackend[] = ['elevenlabs', 'cascaded'];

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function makeEvent(name: string, startsAt: string, hours: number): EventRecord {
  const now = new Date().toISOString();
  return {
    id: newEventId(name),
    name,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + hours * 60 * 60 * 1000).toISOString(),
    timezone: 'Asia/Kolkata',
    brief: { about: '', where: '', notes: '' },
    sourceUrl: null,
    lastImport: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeGuest(
  index: number,
  name: string,
  approvalStatus: ApprovalStatus,
  ticketName: string,
): GuestRecord {
  const sourceId = `seed-gst-${index}`;
  const phone = `+9199000000${String(index).padStart(2, '0')}`;
  return {
    id: guestIdFor({ sourceId, phone }),
    sourceId,
    name,
    email: `${name.split(' ')[0]?.toLowerCase()}@example.com`,
    phone,
    approvalStatus,
    ticketName,
    checkedInAt: null,
    registeredAt: daysFromNow(-20),
    attributes: { 'What should we know?': 'Seed data, never dialed' },
  };
}

function makeCampaign(
  event: EventRecord,
  type: CampaignType,
  prompt: string,
  queue: string[],
): CampaignRecord {
  const now = new Date().toISOString();
  return {
    id: newCampaignId(type),
    eventId: event.id,
    type,
    name: type === 'pre-event' ? 'Pre-event reminder' : 'Post-event follow-up',
    prompt,
    useMasterPrompt: false,
    language: 'en',
    fields:
      type === 'pre-event'
        ? [
            {
              key: 'will_attend',
              label: 'Will the guest attend?',
              kind: 'enum',
              options: ['yes', 'no', 'maybe'],
            },
          ]
        : [
            { key: 'attended', label: 'Did the guest attend?', kind: 'boolean' },
            { key: 'feedback', label: "Feedback in the guest's words", kind: 'text' },
          ],
    callingWindow: { ...WINDOW },
    retryCap: 1,
    voiceBackendOrder: [...BACKEND_ORDER],
    queue,
    createdAt: now,
    updatedAt: now,
  };
}

function makeAttempt(
  campaign: CampaignRecord,
  guest: GuestRecord,
  outcome: CallOutcome,
  minutesAgo: number,
  runId: string,
  extras: Partial<AttemptRecord> = {},
): AttemptRecord {
  const startedAt = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  const endedAt = new Date(new Date(startedAt).getTime() + 95 * 1000).toISOString();
  const answered = outcome === 'answered';
  return {
    id: newAttemptId(startedAt),
    eventId: campaign.eventId,
    campaignId: campaign.id,
    guestId: guest.id,
    runId,
    status: 'done',
    outcome,
    startedAt,
    endedAt,
    transcript: answered
      ? [
          { role: 'agent', text: `Hello ${guest.name}, calling about the event.`, at: startedAt },
          { role: 'guest', text: 'Yes, I was there. It was well run.', at: startedAt },
        ]
      : [],
    capturedFields: answered
      ? { attended: 'yes', feedback: 'Well run, wanted more time' }
      : { attended: 'unknown', feedback: 'unknown' },
    openQuestions: [],
    voiceBackend: answered ? 'elevenlabs' : null,
    fallbackUsed: false,
    providerCallId: `seed-call-${guest.id}`,
    voiceSessionId: answered ? `seed-session-${guest.id}` : null,
    timeline: [
      { at: startedAt, kind: 'created', detail: `queued for ${guest.name}` },
      { at: startedAt, kind: 'dialing', detail: 'seed data, nothing was dialed' },
      ...(answered
        ? ([
            { at: startedAt, kind: 'answered', detail: null },
            { at: startedAt, kind: 'backend_started', detail: 'elevenlabs' },
            { at: endedAt, kind: 'extraction_done', detail: 'attended, feedback' },
          ] as AttemptRecord['timeline'])
        : []),
      { at: endedAt, kind: 'call_ended', detail: outcome },
    ],
    error: null,
    ...extras,
  };
}

/** A finished run, so the results page has run context for its attempts. */
function makeRun(campaign: CampaignRecord, guestIds: string[], minutesAgo: number): RunRecord {
  const startedAt = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  return {
    id: newRunId(startedAt),
    eventId: campaign.eventId,
    campaignId: campaign.id,
    kind: 'queue',
    status: 'completed',
    guestIds,
    currentGuestId: null,
    currentAttemptId: null,
    attemptIds: [],
    skipped: [],
    waiveRetryCap: false,
    waiveCallingWindow: false,
    scheduledFor: null,
    startedAt,
    endedAt: new Date(Date.now() - (minutesAgo - 60) * 60 * 1000).toISOString(),
    error: null,
  };
}

async function seed(): Promise<void> {
  const config = loadConfig();
  const store = new JsonStore(config.dataDir);

  // Upcoming event: guests and a queue to filter and reorder.
  const upcoming = makeEvent('Design Systems Meetup', daysFromNow(14), 3);
  const upcomingGuests = [
    makeGuest(1, 'Asha Rao', 'approved', 'General'),
    makeGuest(2, 'Vikram Shah', 'approved', 'VIP'),
    makeGuest(3, 'Neha Iyer', 'pending_approval', 'General'),
    makeGuest(4, 'Rahul Menon', 'waitlist', 'General'),
    makeGuest(5, 'Divya Nair', 'declined', 'General'),
  ];
  await store.putEvent({
    ...upcoming,
    brief: {
      about: 'A meetup about design systems.',
      where: 'Studio 4, Bandra.',
      notes: 'Bring a laptop. Doors at 6.',
    },
    lastImport: {
      at: new Date().toISOString(),
      importedCount: upcomingGuests.length,
      skippedWithoutPhone: 2,
    },
  });
  await store.replaceGuests(upcoming.id, upcomingGuests);
  await store.putCampaign(
    makeCampaign(
      upcoming,
      'pre-event',
      'Remind {{guest.firstName}} that {{event.name}} starts on {{event.startsAt}} and ask whether they plan to attend.',
      upcomingGuests.slice(0, 3).map((guest) => guest.id),
    ),
  );
  await store.putCampaign(
    makeCampaign(
      upcoming,
      'post-event',
      'Ask {{guest.firstName}} whether they made it to {{event.name}} and what could be better.',
      [],
    ),
  );

  // Finished event: attempts with a spread of outcomes for the results page.
  const finished = makeEvent('Founders Dinner', daysFromNow(-3), 4);
  const finishedGuests = [
    makeGuest(11, 'Kabir Sen', 'approved', 'General'),
    makeGuest(12, 'Meera Joshi', 'approved', 'General'),
    makeGuest(13, 'Arjun Patel', 'approved', 'VIP'),
    makeGuest(14, 'Fatima Sheikh', 'approved', 'General'),
  ];
  await store.putEvent({
    ...finished,
    brief: {
      about: 'A dinner for founders.',
      where: '',
      notes: 'It ran for four hours.',
    },
    lastImport: {
      at: daysFromNow(-5),
      importedCount: finishedGuests.length,
      skippedWithoutPhone: 1,
    },
  });
  await store.replaceGuests(finished.id, finishedGuests);

  const followUp = makeCampaign(
    finished,
    'post-event',
    'Ask {{guest.firstName}} whether they made it to {{event.name}} and what could be better.',
    finishedGuests.map((guest) => guest.id),
  );
  await store.putCampaign(followUp);

  const run = makeRun(
    followUp,
    finishedGuests.map((guest) => guest.id),
    130,
  );
  const attempts: AttemptRecord[] = [
    makeAttempt(followUp, finishedGuests[0]!, 'answered', 120, run.id, {
      openQuestions: [
        {
          id: 'q-seedvenue',
          text: 'Where was the dinner held?',
          status: 'open',
        },
      ],
    }),
    makeAttempt(followUp, finishedGuests[1]!, 'no_answer', 100, run.id),
    makeAttempt(followUp, finishedGuests[2]!, 'answered', 80, run.id, {
      capturedFields: { attended: 'no', feedback: 'unknown' },
      voiceBackend: 'cascaded',
      fallbackUsed: true,
    }),
    makeAttempt(followUp, finishedGuests[3]!, 'failed', 60, run.id, {
      error: 'seed data: dial failed before ringing',
    }),
  ];
  for (const attempt of attempts) {
    await store.putAttempt(attempt);
  }
  await store.putRun({ ...run, attemptIds: attempts.map((attempt) => attempt.id) });

  console.log(`[seed] wrote 2 events into ${config.dataDir}`);
  console.log(`[seed] upcoming: ${upcoming.name} (${upcoming.id})`);
  console.log(`[seed] finished: ${finished.name} (${finished.id}), ${attempts.length} attempts`);
}

await seed();
