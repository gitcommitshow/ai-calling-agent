/**
 * Guest filtering and queue ordering. This is the organizer's call-control
 * policy: the queue is the selected, ordered subset of the guest list, and
 * nothing outside it is ever dialed.
 */
import type { ApprovalStatus, Guest } from './types';

export interface GuestFilter {
  statuses?: ApprovalStatus[];
  ticketNames?: string[];
  checkedIn?: boolean;
  search?: string;
}

/** Apply the organizer's filter. An empty filter keeps the whole list. */
export function filterGuests(guests: Guest[], filter: GuestFilter = {}): Guest[] {
  const needle = filter.search?.trim().toLowerCase();

  return guests.filter((guest) => {
    if (filter.statuses?.length && !filter.statuses.includes(guest.approvalStatus)) return false;
    if (filter.ticketNames?.length && !filter.ticketNames.includes(guest.ticketName ?? '')) {
      return false;
    }
    if (filter.checkedIn !== undefined && Boolean(guest.checkedInAt) !== filter.checkedIn) {
      return false;
    }
    if (needle) {
      const haystack = [guest.name, guest.email ?? '', guest.phone].join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Ticket types present in a list, for the filter controls. */
export function ticketNamesOf(guests: Guest[]): string[] {
  return [...new Set(guests.map((guest) => guest.ticketName).filter((name): name is string => !!name))].sort();
}

/**
 * Fold a new selection into the existing queue: already-queued guests keep
 * their position, newly selected guests go to the end, unselected ones leave.
 */
export function buildQueue(currentQueue: string[], selectedIds: string[]): string[] {
  const selected = new Set(selectedIds);
  const queue = currentQueue.filter((guestId) => selected.has(guestId));
  const placed = new Set(queue);

  for (const guestId of selectedIds) {
    if (placed.has(guestId)) continue;
    placed.add(guestId);
    queue.push(guestId);
  }
  return queue;
}

/** Move one guest up (-1) or down (+1) in the queue. Ends are no-ops. */
export function moveInQueue(queue: string[], guestId: string, direction: -1 | 1): string[] {
  const from = queue.indexOf(guestId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= queue.length) return [...queue];

  const reordered = [...queue];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved!);
  return reordered;
}

/** Guests in queue order, dropping ids that are no longer on the list. */
export function orderByQueue(guests: Guest[], queue: string[]): Guest[] {
  const byId = new Map(guests.map((guest) => [guest.id, guest]));
  return queue.map((guestId) => byId.get(guestId)).filter((guest): guest is Guest => !!guest);
}
