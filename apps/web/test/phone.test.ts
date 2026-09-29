/**
 * Unit tests for guest phone normalization. No live third-party services.
 */
import { expect } from 'chai';
import { canCallPhone, normalizeGuestPhone, normalizeIndianPhone } from '../src/domain/phone';

describe('normalizeGuestPhone', () => {
  it('treats a ten-digit mobile as India', () => {
    expect(normalizeGuestPhone('9876543210')).to.deep.equal({ phone: '+919876543210' });
    expect(normalizeGuestPhone('+91 98765-43210').phone).to.equal('+919876543210');
    expect(normalizeGuestPhone('09876543210').phone).to.equal('+919876543210');
  });

  it('keeps a number that already has another country code', () => {
    expect(normalizeGuestPhone('+1 202 555 0143').phone).to.equal('+12025550143');
    expect(canCallPhone('+12025550143')).to.equal(false);
    expect(canCallPhone('+919876543210')).to.equal(true);
  });

  it('rejects a blank value and a local number that is not an Indian mobile', () => {
    expect(normalizeGuestPhone('  ').reason).to.equal('no phone number');
    expect(normalizeGuestPhone('1234567890').reason).to.match(/country code/);
    expect(normalizeIndianPhone('+1 202 555 0143').phone).to.equal(null);
  });
});
