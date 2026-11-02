import { LOCAL_OFFSET_MS } from './cadence.js';

/** The period a report covers (T-172), in Asia/Ho_Chi_Minh (UTC+7). */
export type ReportPeriod = 'day' | 'week' | 'month';
export type ReportWindow = 'previous' | 'to_date';

export interface ResolvedPeriod {
  /** Local dates (yyyy-mm-dd), inclusive. */
  from: string;
  to: string;
  /** UTC instants: `since` inclusive, `until` exclusive. */
  since: Date;
  until: Date;
}

const DAY_MS = 86_400_000;
const iso = (localMidnight: number) => new Date(localMidnight).toISOString().slice(0, 10);
const utc = (localTime: number) => new Date(localTime - LOCAL_OFFSET_MS);

/**
 * `day` + `previous` = yesterday; `to_date` = today up to `at`. A week runs Monday to Sunday; a
 * month is the calendar month.
 */
export function resolvePeriod(p: ReportPeriod, w: ReportWindow, at: Date): ResolvedPeriod {
  const local = at.getTime() + LOCAL_OFFSET_MS;
  const today = Math.floor(local / DAY_MS) * DAY_MS;
  let start: number;
  if (p === 'day') start = today;
  else if (p === 'week') start = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
  else {
    const d = new Date(today);
    start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  if (w === 'to_date') {
    return { from: iso(start), to: iso(today), since: utc(start), until: at };
  }
  let prevStart: number;
  if (p === 'day') prevStart = start - DAY_MS;
  else if (p === 'week') prevStart = start - 7 * DAY_MS;
  else {
    const d = new Date(start);
    prevStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  }
  return {
    from: iso(prevStart),
    to: iso(start - DAY_MS),
    since: utc(prevStart),
    until: utc(start),
  };
}
