/**
 * Unit tests for guest filtering and queue ordering. No live third-party services.
 */
import { expect } from 'chai';
import { buildQueue, filterGuests, moveInQueue } from '../src/domain/filter-order';
import type { ApprovalStatus, Guest } from '../src/domain/types';

function guest(id: string, approvalStatus: ApprovalStatus, ticketName = 'General'): Guest {
  return {
    id,
    sourceId: id,
    name: `Guest ${id}`,
    email: `${id}@example.com`,
    phone: '+919876543210',
    approvalStatus,
    ticketName,
    checkedInAt: null,
    registeredAt: null,
    attributes: {},
  };
}

const guests = [
  guest('a', 'approved'),
  guest('b', 'pending_approval'),
  guest('c', 'approved', 'VIP'),
  guest('d', 'unknown'),
];

describe('filterGuests', () => {
  it('filters by approval status and ticket type', () => {
    expect(filterGuests(guests, { statuses: ['approved'] }).map((g) => g.id)).to.deep.equal([
      'a',
      'c',
    ]);
    expect(
      filterGuests(guests, { statuses: ['approved'], ticketNames: ['VIP'] }).map((g) => g.id),
    ).to.deep.equal(['c']);
  });

  it('leaves unmapped statuses out unless they are asked for', () => {
    // Guest 'd' has an unmapped status, so it is absent until asked for by name.
    expect(filterGuests(guests, { statuses: ['approved', 'pending_approval'] }).map((g) => g.id))
      .to.deep.equal(['a', 'b', 'c']);
    expect(filterGuests(guests, { statuses: ['unknown'] }).map((g) => g.id)).to.deep.equal(['d']);
  });
});

describe('queue ordering', () => {
  it('keeps positions when the selection changes, and moves one guest at a time', () => {
    const queue = buildQueue(['c', 'a'], ['a', 'b', 'c']);
    expect(queue).to.deep.equal(['c', 'a', 'b']);

    expect(moveInQueue(queue, 'b', -1)).to.deep.equal(['c', 'b', 'a']);
    expect(moveInQueue(queue, 'c', -1)).to.deep.equal(['c', 'a', 'b']);
    expect(buildQueue(queue, ['c', 'b'])).to.deep.equal(['c', 'b']);
  });
});
