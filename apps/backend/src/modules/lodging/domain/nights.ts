import { LodgingError } from './lodging.errors.js';

const DAY_MS = 86_400_000;
export const MAX_STAY_NIGHTS = 60;
export const LOCAL_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Parses a real calendar date 'YYYY-MM-DD' to its UTC midnight in ms; throws otherwise. */
export function nightToUtcMs(night: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(night)) {
    const ms = Date.parse(`${night}T00:00:00.000Z`);
    if (!Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === night) return ms;
  }
  throw new LodgingError('VALIDATION_FAILED', 'Invalid night', { night });
}

export function addNights(night: string, n: number): string {
  return new Date(nightToUtcMs(night) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The nights of a stay: check-in up to, not including, check-out (1..60 nights). */
export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const count = (nightToUtcMs(checkOut) - nightToUtcMs(checkIn)) / DAY_MS;
  if (count < 1 || count > MAX_STAY_NIGHTS) {
    throw new LodgingError('VALIDATION_FAILED', `A stay must last 1 to ${MAX_STAY_NIGHTS} nights`, {
      checkIn,
      checkOut,
    });
  }
  return Array.from({ length: count }, (_, i) => addNights(checkIn, i));
}

/** ISO weekday of a night: Monday = 1 … Sunday = 7 (computed in UTC, so time-zone safe). */
export function isoWeekday(night: string): number {
  const day = new Date(nightToUtcMs(night)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Today's local date 'YYYY-MM-DD' (default Asia/Ho_Chi_Minh). */
export function localToday(now: Date, tz: string = LOCAL_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
