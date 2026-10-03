/**
 * Hand-added guests and phone uniqueness. No live third-party services.
 */
import { rejects } from 'node:assert/strict';
import { expect } from 'chai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GuestInput } from '../src/api/validate.ts';
import { addManualGuest, applyGuestImport, ExistingGuestError } from '../src/guests/roster.ts';
import { JsonStore } from '../src/storage/json-store.ts';
import type { GuestRecord } from '../src/storage/types.ts';

const EVENT = 'launch-party-1234abcd';

function guest(name: string, phone: string, origin: 'imported' | 'manual'): GuestRecord {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    sourceId: origin === 'manual' ? null : name.toLowerCase(),
    name,
    email: null,
    phone,
    approvalStatus: 'approved',
    ticketName: null,
    checkedInAt: null,
    registeredAt: null,
    attributes: {},
    origin,
  };
}

function row(name: string, phone: string): GuestInput {
  return {
    sourceId: name.toLowerCase(),
    name,
    email: null,
    phone,
    approvalStatus: 'approved',
    ticketName: null,
    checkedInAt: null,
    registeredAt: null,
    attributes: {},
  };
}

describe('guest roster', () => {
  let dataDir: string;
  let store: JsonStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'calling-agent-guests-'));
    store = new JsonStore(dataDir);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('stores a guest the organizer typed in', async () => {
    const added = await addManualGuest(store, EVENT, {
      name: 'Riya Sen',
      phone: '+919876543210',
    });

    expect(added.origin).to.equal('manual');
    expect(added.phone).to.equal('+919876543210');
    const stored = await store.listGuests(EVENT);
    expect(stored.map((item) => item.name)).to.deep.equal(['Riya Sen']);
    expect(stored[0]?.origin).to.equal('manual');
  });

  it('refuses a phone that is already on the list and leaves that guest in place', async () => {
    await store.replaceGuests(EVENT, [guest('Asha Rao', '+919876543210', 'imported')]);

    await rejects(
      () => addManualGuest(store, EVENT, { name: 'Other', phone: '+919876543210' }),
      (error: unknown) => {
        expect(error).to.be.instanceOf(ExistingGuestError);
        expect((error as ExistingGuestError).message).to.equal(
          'Asha Rao already has this number (from the import).',
        );
        return true;
      },
    );

    const stored = await store.listGuests(EVENT);
    expect(stored.map((item) => item.name)).to.deep.equal(['Asha Rao']);
  });

  it('keeps hand-added guests on import and skips a phone that is already stored', () => {
    const merged = applyGuestImport([guest('Riya Sen', '+919876543210', 'manual')], [
      row('Someone else', '+919876543210'),
      row('Vikram Shah', '+919876543211'),
      row('Vikram again', '+919876543211'),
    ]);

    expect(merged.guests.map((item) => item.name)).to.deep.equal(['Riya Sen', 'Vikram Shah']);
    expect(merged.guests.map((item) => item.origin)).to.deep.equal(['manual', 'imported']);
    expect(merged.skippedExistingPhones).to.deep.equal([
      {
        phone: '+919876543210',
        existingName: 'Riya Sen',
        incomingName: 'Someone else',
      },
    ]);
    expect(merged.duplicateRowsMerged).to.equal(1);
  });
});
