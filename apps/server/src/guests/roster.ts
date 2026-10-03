/**
 * One phone number belongs to one guest. Hand-added guests stay when a CSV
 * replaces the imported list, and a number already on the list is not added.
 */
import type { GuestInput } from '../api/validate.ts';
import { guestIdFor } from '../storage/ids.ts';
import type { GuestOrigin, GuestRecord, Storage } from '../storage/types.ts';

/** Older guest files have no origin. They all came from an import. */
export function guestOrigin(guest: { origin?: GuestOrigin }): GuestOrigin {
  return guest.origin === 'manual' ? 'manual' : 'imported';
}

/** Raised when a manual add uses a phone that is already stored for the event. */
export class ExistingGuestError extends Error {
  constructor(readonly existing: GuestRecord) {
    const source = guestOrigin(existing) === 'manual' ? 'added by hand' : 'from the import';
    super(`${existing.name} already has this number (${source}).`);
    this.name = 'ExistingGuestError';
  }
}

export interface ManualGuestDraft {
  name: string;
  phone: string;
}

/** A CSV row whose phone is already on the list, so it was not stored. */
export interface SkippedPhone {
  phone: string;
  existingName: string;
  incomingName: string;
}

export interface GuestImportMerge {
  guests: GuestRecord[];
  /** Extra CSV rows that repeat a phone already claimed by this import. */
  duplicateRowsMerged: number;
  skippedExistingPhones: SkippedPhone[];
}

/**
 * Store a guest the organizer typed in. Refuses when that phone is already
 * on the list, whether the existing guest was imported or added by hand.
 */
export async function addManualGuest(
  storage: Storage,
  eventId: string,
  draft: ManualGuestDraft,
): Promise<GuestRecord> {
  const existing = await storage.listGuests(eventId);
  const match = existing.find((guest) => guest.phone === draft.phone);
  if (match) throw new ExistingGuestError(match);

  const guest: GuestRecord = {
    id: unusedGuestId(existing, guestIdFor({ phone: draft.phone })),
    sourceId: null,
    name: draft.name,
    email: null,
    phone: draft.phone,
    approvalStatus: 'approved',
    ticketName: null,
    checkedInAt: null,
    registeredAt: null,
    attributes: {},
    origin: 'manual',
  };
  await storage.replaceGuests(eventId, [...existing, guest]);
  return guest;
}

/**
 * Replace imported guests with this CSV and leave hand-added guests in place.
 * The first row for a phone wins. A phone already held by a hand-added guest
 * is reported and not added.
 */
export function applyGuestImport(existing: GuestRecord[], incoming: GuestInput[]): GuestImportMerge {
  const manual = existing.filter((guest) => guestOrigin(guest) === 'manual');
  const byPhone = new Map<string, GuestRecord>(manual.map((guest) => [guest.phone, guest]));
  const skippedExistingPhones: SkippedPhone[] = [];
  let duplicateRowsMerged = 0;

  for (const row of incoming) {
    const held = byPhone.get(row.phone);
    if (held) {
      if (guestOrigin(held) === 'manual') {
        skippedExistingPhones.push({
          phone: row.phone,
          existingName: held.name,
          incomingName: row.name,
        });
      } else {
        duplicateRowsMerged += 1;
      }
      continue;
    }
    const guest: GuestRecord = { id: guestIdFor(row), ...row, origin: 'imported' };
    byPhone.set(row.phone, guest);
  }

  const imported = [...byPhone.values()].filter((guest) => guestOrigin(guest) === 'imported');
  const guests = assignUniqueIds([...manual, ...imported]);
  return { guests, duplicateRowsMerged, skippedExistingPhones };
}

/** Keep the preferred id unless another guest in this write already uses it. */
function assignUniqueIds(guests: GuestRecord[]): GuestRecord[] {
  const used: { id: string }[] = [];
  return guests.map((guest) => {
    const id = unusedGuestId(used, guest.id);
    used.push({ id });
    return id === guest.id ? guest : { ...guest, id };
  });
}

function unusedGuestId(existing: { id: string }[], preferred: string): string {
  const taken = new Set(existing.map((guest) => guest.id));
  if (!taken.has(preferred)) return preferred;
  let suffix = 2;
  while (taken.has(`${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}
