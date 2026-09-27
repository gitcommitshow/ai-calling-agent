/**
 * Unit tests for Indian phone normalization. No live third-party services.
 */
import { expect } from 'chai';
import { normalizeIndianPhone } from '../src/domain/phone';

describe('normalizeIndianPhone', () => {
  it('turns a ten-digit mobile into E.164', () => {
    expect(normalizeIndianPhone('9876543210')).to.deep.equal({ phone: '+919876543210' });
  });

  it('strips punctuation and country prefixes', () => {
    for (const raw of ['+91 98765-43210', '091 (98765) 43210', '09876543210']) {
      expect(normalizeIndianPhone(raw).phone, raw).to.equal('+919876543210');
    }
  });

  it('rejects non-Indian and malformed numbers with a reason', () => {
    expect(normalizeIndianPhone('+1 202 555 0143').phone).to.equal(null);
    expect(normalizeIndianPhone('+1 202 555 0143').reason).to.match(/only Indian/);
    expect(normalizeIndianPhone('1234567890').reason).to.match(/must start 6-9/);
    expect(normalizeIndianPhone('  ').reason).to.equal('no phone number');
  });
});
