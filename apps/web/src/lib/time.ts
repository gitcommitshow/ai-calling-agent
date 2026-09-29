/**
 * Time helpers. Phase 1 events are in India, so form fields are read and written
 * as Asia/Kolkata wall-clock time (a fixed +05:30 offset, no daylight saving)
 * while storage stays in UTC ISO strings.
 */
const IST_OFFSET = '+05:30';
export const IST = 'Asia/Kolkata';

/** `2026-10-10T18:00` typed in the form becomes the matching UTC instant. */
export function istInputToIso(value: string): string {
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return new Date(`${withSeconds}${IST_OFFSET}`).toISOString();
}

/** Prefill a `datetime-local` input from stored UTC. */
export function isoToIstInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Readable date-time for tables and headings. */
export function formatInZone(iso: string, timeZone = IST): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
