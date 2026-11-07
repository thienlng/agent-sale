/**
 * Pure helpers of "Lịch căn" (`/app/calendar/$propertyId`): the windows of the month, quarter
 * and year views, month grids (Monday first), per-night states and the side-panel figures.
 */
import type { BookingStatus } from '@agent-sales/contracts';

import {
  type CalendarPropertyData,
  type CalendarRowData,
  type CalendarSegmentData,
  rowOccupancy,
  takenByNight,
} from './calendar-model';
import { addDays, isoWeekday, nightList, nightsBetween } from './format';

export const PROPERTY_CALENDAR_VIEWS = ['month', 'quarter', 'year', 'list'] as const;
export type PropertyCalendarView = (typeof PROPERTY_CALENDAR_VIEWS)[number];

/** Months the prev / next buttons move per view (the list view does not step). */
export const VIEW_STEP_MONTHS: Record<PropertyCalendarView, number> = {
  month: 1,
  quarter: 3,
  year: 12,
  list: 0,
};

/** First night of the month of `night`: "2026-11-17" → "2026-11-01". */
export function monthStart(night: string): string {
  return `${night.slice(0, 7)}-01`;
}

/** First night of the month `months` away from the month of `night`. */
export function addMonths(night: string, months: number): string {
  const index = Number(night.slice(0, 4)) * 12 + Number(night.slice(5, 7)) - 1 + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/** The first nights of `count` months from the month of `night`. */
export function monthsFrom(night: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(night, i));
}

/** Monday on or before `night`. */
export function weekStart(night: string): string {
  return addDays(night, 1 - isoWeekday(night));
}

/**
 * Weeks (Monday first) covering a month: from the Monday on or before the 1st to the Sunday on
 * or after the last day, so leading and trailing days of the next months fill the rows.
 */
export function monthWeeks(month: string): string[][] {
  const first = weekStart(monthStart(month));
  const last = addDays(addMonths(month, 1), -1);
  const end = addDays(last, 7 - isoWeekday(last) + 1);
  const days = nightList(first, end);
  return Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
}

/**
 * Nights [from, to) the calendar request of a view covers (at most 371). It starts one night
 * before what is shown, so a booking that starts on the first shown night is not clipped and
 * reads as a real check-in.
 */
export function viewWindow(
  view: PropertyCalendarView,
  anchor: string,
): { from: string; to: string } {
  const month = monthStart(anchor);
  if (view === 'quarter') return { from: addDays(month, -1), to: addMonths(month, 3) };
  if (view === 'year') return { from: addDays(month, -1), to: addMonths(month, 12) };
  // Month and list: the month grid with its leading and trailing days.
  const weeks = monthWeeks(month);
  const first = weeks[0]?.[0] ?? month;
  const lastWeek = weeks[weeks.length - 1];
  const last = lastWeek?.[6] ?? month;
  return { from: addDays(first, -1), to: addDays(last, 1) };
}

/** "11/2026". */
export function monthYearLabel(month: string): string {
  return `${month.slice(5, 7)}/${month.slice(0, 4)}`;
}

/** `{month: '11', year: '2026'}` for the "Tháng {{month}}/{{year}}" strings. */
export function monthParts(month: string): { month: string; year: string } {
  return { month: month.slice(5, 7), year: month.slice(0, 4) };
}

/** Nights shown as "the visible range" by the side panel (adjacent-month days excluded). */
export function visibleNights(view: PropertyCalendarView, anchor: string): string[] {
  const month = monthStart(anchor);
  const months = view === 'quarter' ? 3 : view === 'year' ? 12 : 1;
  return nightList(month, addMonths(month, months));
}

/** State of one night of one row; `free` when no booking takes it. */
export type DayState = 'free' | 'hold' | 'confirmed' | 'checked_in' | 'checked_out' | 'blocked';

export function stateOfStatus(status: BookingStatus): DayState {
  if (status === 'hold' || status === 'confirmed' || status === 'checked_in') return status;
  if (status === 'checked_out') return 'checked_out';
  return 'blocked';
}

/** State of a whole place over several rooms: free, some rooms free, or full. */
export type SummaryState = 'free' | 'partial' | 'full';

/**
 * What a view shows of a property: one room (`unit` names an active room of a rooms property)
 * or every row (a whole property, or "Cả căn"). An unknown unit falls back to every row.
 */
export function scopeOf(
  property: CalendarPropertyData,
  unitId: string | undefined,
): { room: CalendarRowData | undefined; rows: CalendarRowData[] } {
  const room =
    property.sellMode === 'rooms' && unitId
      ? property.rows.find((r) => r.unitId === unitId)
      : undefined;
  return { room, rows: room ? [room] : property.rows };
}

/** Statuses whose total counts as booked revenue (as the server's stay totals). */
const REVENUE_STATUSES: ReadonlySet<BookingStatus> = new Set([
  'confirmed',
  'checked_in',
  'checked_out',
]);

export interface RangeStats {
  /** Taken unit-nights (stays, holds and blocks) over all unit-nights, in %. */
  pct: number;
  takenNights: number;
  totalNights: number;
  /** Unit-nights of confirmed, in-house or checked-out stays. */
  nightsSold: number;
  /** Sum of the totals of those stays that have a night in the range (each booking once). */
  revenue: number;
}

/**
 * Side-panel figures of the rows in scope over the given nights. A booking's total is split
 * evenly over the units it takes (`allRows` = every row of the property), and the rows in scope
 * add their shares: "Cả căn" counts each booking once in full, while a room counts its share of
 * a multi-room or whole-place stay, so the rooms' figures add up to the property's.
 */
export function rangeStats(
  rows: CalendarRowData[],
  nights: string[],
  allRows: CalendarRowData[] = rows,
): RangeStats {
  const first = nights[0];
  const end = nights.length ? addDays(nights[nights.length - 1] ?? '', 1) : '';
  const occ = rowOccupancy(rows, nights);
  const unitsOf = new Map<string, number>();
  for (const row of allRows)
    for (const s of new Set(row.segments.map((x) => x.bookingId)))
      unitsOf.set(s, (unitsOf.get(s) ?? 0) + 1);
  let nightsSold = 0;
  let revenue = 0;
  if (first)
    for (const row of rows) {
      const counted = new Set<string>();
      for (const s of row.segments) {
        if (s.kind !== 'stay' || !REVENUE_STATUSES.has(s.status)) continue;
        const from = s.from < first ? first : s.from;
        const to = s.to > end ? end : s.to;
        const n = nightsBetween(from, to);
        if (n <= 0) continue;
        nightsSold += n;
        if (counted.has(s.bookingId)) continue;
        counted.add(s.bookingId);
        revenue += (s.totalSell ?? 0) / (unitsOf.get(s.bookingId) ?? 1);
      }
    }
  const takenNights = occ.taken.reduce((a, b) => a + b, 0);
  return {
    pct: occ.pct,
    takenNights,
    totalNights: occ.total * nights.length,
    nightsSold,
    // Shares of a split total can be fractional; money stays whole đồng.
    revenue: Math.round(revenue),
  };
}

/** A check-in or check-out of the side panel, read from the calendar's own bookings. */
export interface StayEvent {
  bookingId: string;
  code: string;
  guestName: string;
  /** The check-in or check-out night. */
  night: string;
}

/**
 * The next check-ins and check-outs (up to `max` each) of the rows in scope within the shown
 * nights, from today on. The calendar window starts one night before the shown nights (see
 * `viewWindow`), so a segment starting on the window's first night is a clipped earlier stay
 * and one ending on its last night may continue: both are skipped.
 */
export function stayEvents(
  rows: CalendarRowData[],
  shown: string[],
  today: string,
  window: { from: string; to: string },
  max = 5,
): { checkIns: StayEvent[]; checkOuts: StayEvent[] } {
  const first = shown[0];
  if (!first) return { checkIns: [], checkOuts: [] };
  const end = addDays(shown[shown.length - 1] ?? first, 1);
  const after = first > today ? first : today;
  const stays = new Map<string, CalendarSegmentData>();
  for (const row of rows)
    for (const s of row.segments) if (s.kind === 'stay') stays.set(s.bookingId, s);
  const pick = (key: 'from' | 'to', ok: (s: CalendarSegmentData) => boolean) =>
    [...stays.values()]
      .filter((s) => ok(s) && s[key] >= after && s[key] < end)
      .sort((a, b) => a[key].localeCompare(b[key]) || a.code.localeCompare(b.code))
      .slice(0, max)
      .map((s) => ({
        bookingId: s.bookingId,
        code: s.code,
        guestName: s.guestName,
        night: s[key],
      }));
  return {
    checkIns: pick('from', (s) => s.from > window.from),
    checkOuts: pick('to', (s) => s.to < window.to),
  };
}

/** Occupancy % of each month of `months` (first nights) over the rows in scope. */
export function monthOccupancy(rows: CalendarRowData[], months: string[]): number[] {
  return months.map((m) => rowOccupancy(rows, nightList(m, addMonths(m, 1))).pct);
}

/** What a day cell of the property calendar shows. */
export interface DayInfo {
  /** The booking on the night (single-row scope only). */
  segment: CalendarSegmentData | null;
  /** Free rows / rows in scope. */
  free: number;
  total: number;
  /** Sell price of the night: the row's, or the whole place's on a summary. */
  sell: number | null;
  /** Date-range price label ("Tết"), or ''. */
  label: string;
}

/**
 * Day cells of the rows in scope by night. `summary` (a rooms property seen as "Cả căn") counts
 * free rooms and prices the whole place; otherwise the single row's booking and price.
 */
export function dayInfos(
  property: CalendarPropertyData,
  rows: CalendarRowData[],
  summary: boolean,
  nights: string[],
): Map<string, DayInfo> {
  const taken = rows.map((row) => takenByNight(row, nights));
  const single = rows.length === 1 && !summary ? rows[0] : undefined;
  const prices = new Map(
    (single ? single.prices : property.wholePrices).map((n) => [n.night, n] as const),
  );
  // A room shows its own date-range labels; a whole place shows its own and its rooms'.
  const labels = new Map<string, string>();
  const labelled = single
    ? single.prices
    : [...property.wholePrices, ...rows.flatMap((r) => r.prices)];
  for (const n of labelled) if (n.label && !labels.has(n.night)) labels.set(n.night, n.label);
  const out = new Map<string, DayInfo>();
  nights.forEach((night, i) => {
    const free = taken.filter((r) => r[i] === null).length;
    out.set(night, {
      segment: single ? (taken[0]?.[i] ?? null) : null,
      free,
      total: rows.length,
      sell: prices.get(night)?.sell ?? null,
      label: labels.get(night) ?? '',
    });
  });
  return out;
}

/** Colour state of a day cell in the compact (quarter, year) months. */
export function compactState(day: DayInfo | undefined, summary: boolean): DayState | SummaryState {
  if (!day) return 'free';
  if (summary) return day.free === day.total ? 'free' : day.free === 0 ? 'full' : 'partial';
  return day.segment ? stateOfStatus(day.segment.status) : 'free';
}

/** URL search of "Lịch căn"; the URL is the source of truth so links and Back restore a view. */
export interface PropertyCalendarSearch {
  view?: PropertyCalendarView | undefined;
  /** Any night of the anchor month; absent = today's month. */
  from?: string | undefined;
  /** A room of a rooms property; absent = the whole place. */
  unit?: string | undefined;
}

/** The search without empty or default values, so URLs stay short. */
export function compactSearch(s: PropertyCalendarSearch): PropertyCalendarSearch {
  return {
    ...(s.view && s.view !== 'month' ? { view: s.view } : {}),
    ...(s.from ? { from: s.from } : {}),
    ...(s.unit ? { unit: s.unit } : {}),
  };
}
