/**
 * Unit tests for the JSON store's write guarantees. No live third-party services.
 */
import { rejects } from 'node:assert/strict';
import { expect } from 'chai';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/storage/json-store.ts';
import { writeJsonAtomic } from '../src/storage/atomic.ts';
import type { EventRecord, GuestRecord } from '../src/storage/types.ts';

function sampleEvent(id = 'launch-party-1234abcd'): EventRecord {
  return {
    id,
    name: 'Launch party',
    startsAt: '2026-10-01T12:30:00.000Z',
    endsAt: '2026-10-01T16:30:00.000Z',
    timezone: 'Asia/Kolkata',
    lastImport: null,
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
  };
}

function sampleGuest(id: string, phone: string): GuestRecord {
  return {
    id,
    sourceId: id,
    name: 'Asha Rao',
    email: 'asha@example.com',
    phone,
    approvalStatus: 'approved',
    ticketName: 'General',
    checkedInAt: null,
    registeredAt: null,
    attributes: {},
  };
}

describe('JsonStore', () => {
  let dataDir: string;
  let store: JsonStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'calling-agent-store-'));
    store = new JsonStore(dataDir);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('round-trips an event and replaces the guest list on re-import', async () => {
    const event = sampleEvent();
    await store.putEvent(event);
    await store.replaceGuests(event.id, [
      sampleGuest('asha', '+919876543210'),
      sampleGuest('vikram', '+919876543211'),
    ]);

    expect(await store.getEvent(event.id)).to.deep.equal(event);
    expect((await store.listGuests(event.id)).map((guest) => guest.id)).to.deep.equal([
      'asha',
      'vikram',
    ]);

    await store.replaceGuests(event.id, [sampleGuest('vikram', '+919876543211')]);
    expect((await store.listGuests(event.id)).map((guest) => guest.id)).to.deep.equal(['vikram']);
    expect(await store.getGuest(event.id, 'asha')).to.equal(null);
  });

  it('leaves the previous record intact and no temp file behind when a write fails', async () => {
    const event = sampleEvent();
    await store.putEvent(event);
    const eventFile = join(dataDir, 'events', event.id, 'event.json');

    // BigInt cannot be serialized, so the write fails before the rename.
    await rejects(() => writeJsonAtomic(eventFile, { broken: 1n }), TypeError);

    expect(await store.getEvent(event.id)).to.deep.equal(event);
    const files = await readdir(join(dataDir, 'events', event.id));
    expect(files).to.deep.equal(['event.json']);
  });

  it('rejects ids that would escape the data folder', async () => {
    await rejects(() => store.getEvent('../../etc'), /invalid event id/);
    await rejects(() => store.getGuest('launch-party-1234abcd', '..'), /invalid guest id/);
  });

  it('reads an older attempt file that has no status or timeline as a finished call', async () => {
    const eventId = 'founders-dinner-e2319755';
    await writeJsonAtomic(join(dataDir, 'events', eventId, 'attempts', '20260927122811-f6d27940.json'), {
      id: '20260927122811-f6d27940',
      eventId,
      campaignId: 'post-event-bf98eee4',
      guestId: 'seed-gst-11-0f289002b7',
      outcome: 'answered',
      startedAt: '2026-09-27T12:28:11.953Z',
      endedAt: '2026-09-27T12:29:46.953Z',
      transcript: [],
      capturedFields: { attended: 'yes' },
      voiceBackend: 'elevenlabs',
      fallbackUsed: false,
      error: null,
    });

    const [attempt] = await store.listAttempts(eventId);
    if (!attempt) throw new Error('expected a stored attempt');
    expect(attempt.status).to.equal('done');
    expect(attempt.outcome).to.equal('answered');
    expect(attempt.timeline).to.deep.equal([]);
    expect(attempt.runId).to.equal(null);
    expect(await store.getAttempt(eventId, attempt.id)).to.deep.equal(attempt);
  });
});
