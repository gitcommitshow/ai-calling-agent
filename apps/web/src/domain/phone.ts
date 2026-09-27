/**
 * Phone normalization for phase 1, which calls India only. Written in-house on
 * purpose (DESIGN D8): the rule set is small and we want the reject reason to be
 * something the organizer can read.
 */

export interface PhoneResult {
  /** E.164 number, or null when the row cannot be called. */
  phone: string | null;
  reason?: string;
}

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** Normalize one raw CSV or form value to +91 E.164, or explain the rejection. */
export function normalizeIndianPhone(raw: string | null | undefined): PhoneResult {
  if (raw === null || raw === undefined) return { phone: null, reason: 'no phone number' };

  const trimmed = raw.trim();
  if (trimmed === '') return { phone: null, reason: 'no phone number' };

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return { phone: null, reason: 'no digits in phone number' };

  let national: string | null = null;
  if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    national = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    national = digits.slice(2);
  } else if (digits.length === 13 && digits.startsWith('091')) {
    national = digits.slice(3);
  }

  if (national === null) {
    return {
      phone: null,
      reason: hasPlus
        ? 'only Indian (+91) numbers can be called in phase 1'
        : 'phone number is not a 10-digit Indian mobile',
    };
  }
  if (!INDIAN_MOBILE.test(national)) {
    return { phone: null, reason: 'not an Indian mobile number (must start 6-9)' };
  }
  return { phone: `+91${national}` };
}

/** Readable form for tables: +91 98765 43210. */
export function formatIndianPhone(phone: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return match ? `+91 ${match[1]} ${match[2]}` : phone;
}
