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

/** Prefill a `datetime-local` input from stored UTC, in India. */
export function isoToIstInput(iso: string): string {
  return isoToZonedInput(iso, IST);
}

/** Prefill a `datetime-local` input from stored UTC, in `timeZone`. */
export function isoToZonedInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * Wall-clock `YYYY-MM-DDTHH:MM` in `timeZone` as a UTC instant. Used when the
 * organizer picks a start time in the campaign's calling-window timezone.
 */
export function zonedInputToIso(value: string, timeZone: string): string {
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(withSeconds);
  if (!match) throw new Error('choose a date and time');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const corrected = utcGuess - zoneOffsetMs(new Date(utcGuess), timeZone);
  const instant = new Date(utcGuess - zoneOffsetMs(new Date(corrected), timeZone));
  if (Number.isNaN(instant.getTime())) throw new Error('choose a date and time');
  return instant.toISOString();
}

/** Milliseconds that `timeZone` is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = get('hour') === 24 ? 0 : get('hour');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asUtc - instant.getTime();
}

/** Readable date-time for tables and headings. */
export function formatInZone(iso: string, timeZone = IST): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
