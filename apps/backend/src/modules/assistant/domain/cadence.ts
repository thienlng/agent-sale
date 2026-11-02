/**
 * When a schedule runs (T-172, S3-R3): a structured cadence, never cron. Every `at`,
 * `activeFrom` and `activeTo` is local time in Asia/Ho_Chi_Minh (UTC+7, no DST); every Date
 * here is a UTC instant.
 */
export type Cadence =
  | { kind: 'daily'; at: string }
  | { kind: 'weekly'; days: number[]; at: string }
  | { kind: 'monthly'; day: number; at: string }
  | {
      kind: 'every';
      minutes: number;
      activeFrom?: string | undefined;
      activeTo?: string | undefined;
    };

/** A cadence slot later than this is not run late but recorded as missed (S3-R15). */
export const MISSED_AFTER_MS = 6 * 3_600_000;

/** Asia/Ho_Chi_Minh is UTC+7 all year. */
export const LOCAL_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Minutes since local midnight of `HH:mm`. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** The local midnight (as a "local" epoch: UTC fields = local wall clock) of a local instant. */
const localMidnight = (local: number) => Math.floor(local / DAY_MS) * DAY_MS;

/** ISO weekday (1 = Monday … 7 = Sunday) of a local midnight. */
const isoWeekday = (midnight: number) => ((new Date(midnight).getUTCDay() + 6) % 7) + 1;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The first run time strictly after `after`. */
export function nextRunAt(c: Cadence, after: Date): Date {
  const local = after.getTime() + LOCAL_OFFSET_MS;
  const today = localMidnight(local);
  const toUtc = (localTime: number) => new Date(localTime - LOCAL_OFFSET_MS);
  switch (c.kind) {
    case 'daily': {
      const at = minutesOf(c.at) * MINUTE_MS;
      for (let d = 0; d <= 1; d++) {
        const slot = today + d * DAY_MS + at;
        if (slot > local) return toUtc(slot);
      }
      break;
    }
    case 'weekly': {
      const at = minutesOf(c.at) * MINUTE_MS;
      for (let d = 0; d <= 7; d++) {
        const midnight = today + d * DAY_MS;
        if (!c.days.includes(isoWeekday(midnight))) continue;
        const slot = midnight + at;
        if (slot > local) return toUtc(slot);
      }
      break;
    }
    case 'monthly': {
      const at = minutesOf(c.at) * MINUTE_MS;
      const now = new Date(today);
      for (let m = 0; m <= 2; m++) {
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth() + m;
        const last = lastDayOfMonth(year, month);
        const day = c.day === -1 ? last : Math.min(c.day, last);
        const slot = Date.UTC(year, month, day) + at;
        if (slot > local) return toUtc(slot);
      }
      break;
    }
    case 'every': {
      const step = c.minutes * MINUTE_MS;
      const from = c.activeFrom !== undefined ? minutesOf(c.activeFrom) : 0;
      // Length of the active window from `from`; a missing window or `to == from` = all day.
      const span =
        c.activeFrom !== undefined && c.activeTo !== undefined
          ? (minutesOf(c.activeTo) - from + 1440) % 1440 || 1440
          : 1440;
      // Slots restart every day at the window start (yesterday's window may span midnight).
      for (let d = -1; d <= 2; d++) {
        const start = today + d * DAY_MS + from * MINUTE_MS;
        const end = start + Math.min(span * MINUTE_MS, DAY_MS - 1);
        for (let slot = start; slot <= end && slot < start + DAY_MS; slot += step) {
          if (slot > local) return toUtc(slot);
        }
      }
      break;
    }
  }
  throw new Error('cadence has no next run');
}

/** The next `n` run times after `after`, in order. */
export function nextRuns(c: Cadence, after: Date, n: number): Date[] {
  const out: Date[] = [];
  let at = after;
  for (let i = 0; i < n; i++) {
    at = nextRunAt(c, at);
    out.push(at);
  }
  return out;
}

/** Whether a cadence slot is too late to run now (S3-R15). */
export function isMissed(slot: Date, now: Date): boolean {
  return now.getTime() - slot.getTime() > MISSED_AFTER_MS;
}
