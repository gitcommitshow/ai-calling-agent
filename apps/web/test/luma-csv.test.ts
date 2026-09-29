/**
 * Unit tests for Luma CSV import mapping. No live third-party services.
 */
import { expect } from 'chai';
import { parseLumaCsv } from '../src/domain/luma-csv';

const HEADER = 'api_id,name,email,phone_number,approval_status,ticket_name,created_at';

describe('parseLumaCsv', () => {
  it('maps known columns and preserves approval statuses', () => {
    const csv = [
      HEADER,
      'gst-1,Asha Rao,asha@example.com,+91 98765 43210,approved,General,2026-09-01T10:00:00.000Z',
      'gst-2,Vikram Shah,vikram@example.com,9876543211,pending_approval,VIP,2026-09-02T10:00:00.000Z',
      'gst-3,Neha Iyer,neha@example.com,9876543212,Not Going,General,2026-09-03T10:00:00.000Z',
    ].join('\n');

    const result = parseLumaCsv(csv);

    expect(result.guests.map((guest) => guest.approvalStatus)).to.deep.equal([
      'approved',
      'pending_approval',
      'declined',
    ]);
    expect(result.guests[0]).to.include({
      sourceId: 'gst-1',
      name: 'Asha Rao',
      phone: '+919876543210',
      ticketName: 'General',
      registeredAt: '2026-09-01T10:00:00.000Z',
    });
    expect(result.skippedWithoutPhone).to.equal(0);
  });

  it('keeps custom question columns, including quoted commas and line breaks', () => {
    const csv = [
      `${HEADER},What should we know?`,
      'gst-1,Asha Rao,asha@example.com,9876543210,approved,General,2026-09-01T10:00:00.000Z,"Vegetarian, no nuts\nand I arrive late"',
    ].join('\n');

    const result = parseLumaCsv(csv);

    expect(result.parseErrors).to.deep.equal([]);
    expect(result.guests).to.have.lengthOf(1);
    expect(result.guests[0]!.attributes['What should we know?']).to.equal(
      'Vegetarian, no nuts\nand I arrive late',
    );
  });

  it('skips guests without a usable phone and reports why', () => {
    const csv = [
      HEADER,
      'gst-1,Asha Rao,asha@example.com,,approved,General,2026-09-01T10:00:00.000Z',
      'gst-2,Sam Fox,sam@example.com,+1 202 555 0143,approved,General,2026-09-02T10:00:00.000Z',
      'gst-3,Neha Iyer,neha@example.com,9876543212,approved,General,2026-09-03T10:00:00.000Z',
    ].join('\n');

    const result = parseLumaCsv(csv);

    expect(result.guests.map((guest) => guest.name)).to.deep.equal(['Sam Fox', 'Neha Iyer']);
    expect(result.guests.map((guest) => guest.phone)).to.deep.equal(['+12025550143', '+919876543212']);
    expect(result.skippedWithoutPhone).to.equal(1);
    expect(result.skipped.map((row) => row.row)).to.deep.equal([2]);
  });
});
