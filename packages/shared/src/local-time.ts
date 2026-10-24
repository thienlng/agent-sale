/**
 * Local calendar dates in a workspace time zone ↔ UTC instants, with Intl only
 * (no date library). Sales are reported per local day: an order at 23:30 in
 * Hồ Chí Minh City belongs to that day, not to the next UTC day.
 */

/** Offset (ms) of `timeZone` from UTC at the instant `at`. */
function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The UTC instant of 00:00 on `date` (yyyy-mm-dd) in `timeZone`. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // Two passes settle the offset around DST changes.
  let at = guess - offsetMs(guess, timeZone);
  at = guess - offsetMs(at, timeZone);
  return new Date(at);
}

/** yyyy-mm-dd of `at` in `timeZone`. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** The next calendar date (yyyy-mm-dd). */
export function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = nextDate(d)) out.push(d);
  return out;
}
