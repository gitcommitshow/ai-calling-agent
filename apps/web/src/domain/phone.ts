/**
 * Phone normalization. A number with no country code is treated as India, because
 * that is the usual guest. Any other E.164 number is kept. Calling outside India
 * is still refused later, until that support exists.
 *
 * Written in-house on purpose (DESIGN D8): the rule set is small and the reject
 * reason should be something the organizer can read.
 */

export interface PhoneResult {
  /** E.164 number, or null when the value cannot be stored. */
  phone: string | null;
  reason?: string;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const CALLABLE_INDIAN = /^\+91[6-9]\d{9}$/;

/**
 * Country calling codes, prefix-free, so a pasted number can be split. Longest
 * match wins. A code that is missing still stores; the form falls back to the
 * first three digits.
 */
const CALLING_CODES = [
  '1', '7',
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58',
  '60', '61', '62', '63', '64', '65', '66',
  '81', '82', '84', '86',
  '90', '91', '92', '93', '94', '95', '98',
  '211', '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228', '229',
  '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242', '243', '244',
  '245', '246', '248', '249', '250', '251', '252', '253', '254', '255', '256', '257', '258', '260', '261',
  '262', '263', '264', '265', '266', '267', '268', '269',
  '290', '291', '297', '298', '299',
  '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374',
  '375', '376', '377', '378', '380', '381', '382', '385', '386', '387', '389',
  '420', '421', '423',
  '500', '501', '502', '503', '504', '505', '506', '507', '508', '509',
  '590', '591', '592', '593', '594', '595', '596', '597', '598', '599',
  '670', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681', '682', '683', '685', '686',
  '687', '688', '689', '690', '691', '692',
  '850', '852', '853', '855', '856', '880', '886',
  '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973', '974', '975',
  '976', '977', '992', '993', '994', '995', '996', '998',
].sort((a, b) => b.length - a.length);

/** Split a digit string into a calling code and the rest, when the code is known. */
export function splitCallingCode(digits: string): { code: string; national: string } | null {
  const code = CALLING_CODES.find((candidate) => digits.startsWith(candidate) && digits.length > candidate.length);
  if (!code) return null;
  return { code, national: digits.slice(code.length) };
}

/** True when a stored number can be dialed today. Other countries are kept, not called. */
export function canCallPhone(phone: string): boolean {
  return CALLABLE_INDIAN.test(phone);
}

/**
 * Normalize one raw CSV or form value to E.164. Without a country code, only an
 * Indian mobile is assumed.
 */
export function normalizeGuestPhone(raw: string | null | undefined): PhoneResult {
  if (raw === null || raw === undefined) return { phone: null, reason: 'no phone number' };

  const trimmed = raw.trim();
  if (trimmed === '') return { phone: null, reason: 'no phone number' };

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return { phone: null, reason: 'no digits in phone number' };

  if (hasPlus) {
    const phone = `+${digits}`;
    if (!E164.test(phone)) {
      return { phone: null, reason: 'use a full number with a country code, like +91 98765 43210' };
    }
    return { phone };
  }

  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith('091')) national = digits.slice(3);

  if (national && INDIAN_MOBILE.test(national)) return { phone: `+91${national}` };
  if (national) {
    return { phone: null, reason: 'that is not an Indian mobile. Add the country code, like +1 or +44' };
  }
  return { phone: null, reason: 'add a country code, like +91 or +1' };
}

/** Test calls and the saved test number stay on Indian mobiles. */
export function normalizeIndianPhone(raw: string | null | undefined): PhoneResult {
  const parsed = normalizeGuestPhone(raw);
  if (!parsed.phone) return parsed;
  if (!canCallPhone(parsed.phone)) {
    return { phone: null, reason: 'only Indian (+91) numbers can be called right now' };
  }
  return parsed;
}

/** Readable form. Indian mobiles are grouped; other numbers keep their country code. */
export function formatPhone(phone: string): string {
  const indian = /^\+91(\d{5})(\d{5})$/.exec(phone);
  if (indian) return `+91 ${indian[1]} ${indian[2]}`;
  const split = splitCallingCode(phone.replace(/\D/g, ''));
  return split ? `+${split.code} ${split.national}` : phone;
}

/** Same display as formatPhone. Kept so existing call sites stay stable. */
export function formatIndianPhone(phone: string): string {
  return formatPhone(phone);
}
