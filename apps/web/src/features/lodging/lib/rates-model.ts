import type { PropertyDto, PutRatesRequest, Surcharges } from '@agent-sales/contracts';
import type { z } from 'zod';

/** ISO weekdays in table order: T2 … CN. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** One weekday cell; 0 = empty (a nightly price is never 0). */
export interface RateCell {
  sell: number;
  cost: number;
}

/**
 * One row of the weekday table: the whole place (`unitId` null) or one room.
 * `required` rows must cover all seven days; optional rows are either empty or complete.
 */
export interface RateRow {
  unitId: string | null;
  name: string;
  required: boolean;
  inactive: boolean;
  cells: RateCell[];
}

export interface PriceDraft {
  sell: number;
  cost: number;
}

export interface RatesDraft {
  rows: RateRow[];
  extraAdult: PriceDraft;
  extraChild: PriceDraft;
  childFreeBelow: number;
  childAdultFrom: number;
}

const emptyCells = (): RateCell[] => WEEKDAYS.map(() => ({ sell: 0, cost: 0 }));

/**
 * Rows of the weekday table: the whole place first (required for a `whole` place,
 * optional for `rooms`), then every room of a `rooms` place; active rooms are required,
 * inactive rooms are shown so their prices survive a save.
 */
export function ratesDraftOf(p: PropertyDto, wholeName: string): RatesDraft {
  const rooms = p.sellMode === 'rooms' ? p.units.filter((u) => u.kind === 'room') : [];
  const rows: RateRow[] = [
    {
      unitId: null,
      name: wholeName,
      required: p.sellMode === 'whole',
      inactive: false,
      cells: emptyCells(),
    },
    ...rooms.map((u) => ({
      unitId: u.id,
      name: u.name,
      required: u.active,
      inactive: !u.active,
      cells: emptyCells(),
    })),
  ];
  for (const rate of p.rates) {
    if (rate.kind !== 'weekday') continue;
    const row = rows.find((r) => r.unitId === rate.unitId);
    if (!row) continue;
    for (const day of rate.weekdays) row.cells[day - 1] = { sell: rate.sell, cost: rate.cost };
  }
  return {
    rows,
    extraAdult: p.surcharges.extraAdult ?? { sell: 0, cost: 0 },
    extraChild: p.surcharges.extraChild ?? { sell: 0, cost: 0 },
    childFreeBelow: p.childFreeBelow,
    childAdultFrom: p.childAdultFrom,
  };
}

/** Copies the cell of `fromDay` into every day up to `toDay` (ISO, inclusive). */
export function fillDays(row: RateRow, fromDay: number, toDay: number): RateRow {
  const source = row.cells[fromDay - 1] ?? { sell: 0, cost: 0 };
  return {
    ...row,
    cells: row.cells.map((c, i) => (i + 1 > fromDay && i + 1 <= toDay ? { ...source } : c)),
  };
}

/** Weekdays (ISO) without a sell price in a row that must be complete; [] when fine. */
export function missingDays(row: RateRow): number[] {
  const empty = WEEKDAYS.filter((d) => !row.cells[d - 1]?.sell);
  if (row.required) return empty;
  return empty.length === WEEKDAYS.length ? [] : empty;
}

export interface RatesErrors {
  /** Row index → missing weekdays. */
  rows: Map<number, number[]>;
  childAges: boolean;
  /** No row has any price (e.g. every room off and no whole-place price): nothing to save. */
  empty: boolean;
}

export function validateRates(d: RatesDraft): RatesErrors {
  const rows = new Map<number, number[]>();
  d.rows.forEach((row, i) => {
    const missing = missingDays(row);
    if (missing.length) rows.set(i, missing);
  });
  const empty = d.rows.every((row) => WEEKDAYS.every((day) => !row.cells[day - 1]?.sell));
  return { rows, childAges: d.childFreeBelow > d.childAdultFrom, empty };
}

export const hasRatesErrors = (e: RatesErrors) => e.rows.size > 0 || e.childAges || e.empty;

const priceOrNull = (p: PriceDraft) => (p.sell ? { sell: p.sell, cost: p.cost || p.sell } : null);

/**
 * PUT body: each non-empty row becomes rules; runs of consecutive days with the same
 * sell and cost are saved as one rule (an empty cost means "same as sell").
 */
export function ratesBody(d: RatesDraft, version: number): z.input<typeof PutRatesRequest> {
  const weekday: z.input<typeof PutRatesRequest>['weekday'] = [];
  for (const row of d.rows) {
    if (WEEKDAYS.every((day) => !row.cells[day - 1]?.sell)) continue;
    let run: { weekdays: number[]; sell: number; cost: number } | null = null;
    for (const day of WEEKDAYS) {
      const cell = row.cells[day - 1] ?? { sell: 0, cost: 0 };
      const cost = cell.cost || cell.sell;
      if (run && run.sell === cell.sell && run.cost === cost) {
        run.weekdays.push(day);
        continue;
      }
      if (run) weekday.push({ unitId: row.unitId, ...run });
      run = { weekdays: [day], sell: cell.sell, cost };
    }
    if (run) weekday.push({ unitId: row.unitId, ...run });
  }
  const surcharges: Surcharges = {
    extraAdult: priceOrNull(d.extraAdult),
    extraChild: priceOrNull(d.extraChild),
  };
  return { version, weekday, surcharges };
}
