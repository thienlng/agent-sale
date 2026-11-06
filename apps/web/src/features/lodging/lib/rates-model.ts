import type { PropertyDto, PutRatesRequest, Surcharges } from '@agent-sales/contracts';
import type { z } from 'zod';

import { type PackageDraft, packageDraftOf, packageInputOf } from './packages-model';

/** ISO weekdays in table order: T2 … CN. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** One weekday cell; 0 = empty (a nightly price is never 0). */
export interface RateCell {
  sell: number;
  cost: number;
}

/**
 * A rental target of the weekday table: the whole place (`unitId` null) or one room.
 * `required` targets must price all seven days; optional ones are either empty or complete.
 */
export interface RateTarget {
  unitId: string | null;
  name: string;
  required: boolean;
  inactive: boolean;
}

/**
 * How a row must be filled: `all` = every weekday; `allOrNone` = empty or every weekday;
 * `any` = any subset (a package that is not the full one: an empty day is "not sold").
 */
export type RowFill = 'all' | 'allOrNone' | 'any';

/**
 * One row of the weekday table: a target without packages, or one package of a target
 * (`packageKey` set). Rows are derived from the draft (`rateRows`), never stored.
 */
export interface RateRow {
  key: string;
  unitId: string | null;
  packageKey: string | null;
  /** The target's name; a package row is labelled with `packageName`. */
  name: string;
  packageName: string;
  /** True for the full package (most bedrooms) of a target with packages. */
  full: boolean;
  fill: RowFill;
  /** Only for a target without packages: the whole place of a `rooms` place. */
  wholeOptional: boolean;
  inactive: boolean;
  cells: RateCell[];
}

export interface PriceDraft {
  sell: number;
  cost: number;
}

export interface RatesDraft {
  targets: RateTarget[];
  /** Packages of the shown targets, in saved order (new ones appended). */
  packages: PackageDraft[];
  /** Row key (`rowKey`) → seven cells. */
  cells: Record<string, RateCell[]>;
  extraAdult: PriceDraft;
  extraChild: PriceDraft;
  childFreeBelow: number;
  childAdultFrom: number;
}

export const emptyCells = (): RateCell[] => WEEKDAYS.map(() => ({ sell: 0, cost: 0 }));

/** Cells key of a target's plain row (`packageKey` null) or of one of its packages. */
export const rowKey = (unitId: string | null, packageKey: string | null) =>
  packageKey ?? `target:${unitId ?? 'whole'}`;

const hasPrice = (cells: RateCell[] | undefined) => Boolean(cells?.some((c) => c.sell));

/** Packages of one target. */
export const packagesOf = (packages: PackageDraft[], unitId: string | null) =>
  packages.filter((k) => k.unitId === unitId);

/**
 * The full package of a target: most bedrooms; ties go to the later one in the list
 * (the server's later `sort_order`). An empty bedrooms field counts as 0.
 */
export function fullPackageKey(packages: PackageDraft[], unitId: string | null): string | null {
  let best: PackageDraft | null = null;
  for (const k of packagesOf(packages, unitId))
    if (!best || (k.bedrooms ?? 0) >= (best.bedrooms ?? 0)) best = k;
  return best?.key ?? null;
}

/**
 * Targets of the weekday table: the whole place first (required for a `whole` place,
 * optional for `rooms`), then every room of a `rooms` place; active rooms are required,
 * inactive rooms are shown so their prices and packages survive a save.
 */
export function ratesDraftOf(p: PropertyDto, wholeName: string): RatesDraft {
  const rooms = p.sellMode === 'rooms' ? p.units.filter((u) => u.kind === 'room') : [];
  const targets: RateTarget[] = [
    { unitId: null, name: wholeName, required: p.sellMode === 'whole', inactive: false },
    ...rooms.map((u) => ({ unitId: u.id, name: u.name, required: u.active, inactive: !u.active })),
  ];
  const shown = new Set(targets.map((t) => t.unitId));
  const packages = [...p.packages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((k) => shown.has(k.unitId))
    .map(packageDraftOf);
  const known = new Set(packages.map((k) => k.key));
  const cells: Record<string, RateCell[]> = {};
  for (const rate of p.rates) {
    if (rate.kind !== 'weekday' || !shown.has(rate.unitId)) continue;
    if (rate.packageId && !known.has(rate.packageId)) continue;
    const key = rowKey(rate.unitId, rate.packageId);
    const row = (cells[key] ??= emptyCells());
    for (const day of rate.weekdays) row[day - 1] = { sell: rate.sell, cost: rate.cost };
  }
  return {
    targets,
    packages,
    cells,
    extraAdult: p.surcharges.extraAdult ?? { sell: 0, cost: 0 },
    extraChild: p.surcharges.extraChild ?? { sell: 0, cost: 0 },
    childFreeBelow: p.childFreeBelow,
    childAdultFrom: p.childAdultFrom,
  };
}

/**
 * Rows of the table in target order; a target with packages gets one row per package,
 * most bedrooms first. Its full package must price every day when the target is
 * required or when any of its packages has a price; the others may skip days.
 */
export function rateRows(d: RatesDraft): RateRow[] {
  const rows: RateRow[] = [];
  for (const target of d.targets) {
    const own = packagesOf(d.packages, target.unitId);
    const base = { unitId: target.unitId, name: target.name, inactive: target.inactive };
    if (own.length === 0) {
      const key = rowKey(target.unitId, null);
      rows.push({
        ...base,
        key,
        packageKey: null,
        packageName: '',
        full: false,
        fill: target.required ? 'all' : 'allOrNone',
        wholeOptional: target.unitId === null && !target.required,
        cells: d.cells[key] ?? emptyCells(),
      });
      continue;
    }
    const full = fullPackageKey(d.packages, target.unitId);
    const priced = target.required || own.some((k) => hasPrice(d.cells[k.key]));
    const sorted = own
      .map((k, i) => ({ k, i }))
      .sort((a, b) => (b.k.bedrooms ?? 0) - (a.k.bedrooms ?? 0) || b.i - a.i);
    for (const { k } of sorted)
      rows.push({
        ...base,
        key: k.key,
        packageKey: k.key,
        packageName: k.name.trim(),
        full: k.key === full,
        fill: k.key !== full ? 'any' : priced ? 'all' : 'allOrNone',
        wholeOptional: false,
        cells: d.cells[k.key] ?? emptyCells(),
      });
  }
  return rows;
}

/** Weekdays (ISO) without a sell price in a row that must be complete; [] when fine. */
export function missingDays(row: RateRow): number[] {
  const empty = WEEKDAYS.filter((d) => !row.cells[d - 1]?.sell);
  if (row.fill === 'any') return [];
  if (row.fill === 'all') return empty;
  return empty.length === WEEKDAYS.length ? [] : empty;
}

export interface RatesErrors {
  /** Row key → missing weekdays. */
  rows: Map<string, number[]>;
  childAges: boolean;
  /** No row has any price (e.g. every room off and no whole-place price): nothing to save. */
  empty: boolean;
}

export function validateRates(d: RatesDraft): RatesErrors {
  const rows = new Map<string, number[]>();
  const all = rateRows(d);
  for (const row of all) {
    const missing = missingDays(row);
    if (missing.length) rows.set(row.key, missing);
  }
  const empty = all.every((row) => !hasPrice(row.cells));
  return { rows, childAges: d.childFreeBelow > d.childAdultFrom, empty };
}

export const hasRatesErrors = (e: RatesErrors) => e.rows.size > 0 || e.childAges || e.empty;

const priceOrNull = (p: PriceDraft) => (p.sell ? { sell: p.sell, cost: p.cost || p.sell } : null);

/**
 * PUT body: each non-empty row becomes rules; runs of consecutive priced days with the
 * same sell and cost are saved as one rule (an empty cost means "same as sell"); an
 * empty day of a package row is not sent ("not sold"). Every package of the draft is
 * sent back, so packages without prices (an inactive room's) are kept. `packageKey` and
 * `packages` are left out when unused: the server defaults are null and [].
 */
export function ratesBody(d: RatesDraft, version: number): z.input<typeof PutRatesRequest> {
  const weekday: z.input<typeof PutRatesRequest>['weekday'] = [];
  for (const row of rateRows(d)) {
    if (!hasPrice(row.cells)) continue;
    const pkg = row.packageKey ? { packageKey: row.packageKey } : {};
    let run: { weekdays: number[]; sell: number; cost: number } | null = null;
    const flush = () => {
      if (run) weekday.push({ unitId: row.unitId, ...run, ...pkg });
      run = null;
    };
    for (const day of WEEKDAYS) {
      const cell = row.cells[day - 1] ?? { sell: 0, cost: 0 };
      if (!cell.sell) {
        flush();
        continue;
      }
      const cost = cell.cost || cell.sell;
      if (run && run.sell === cell.sell && run.cost === cost) {
        run.weekdays.push(day);
        continue;
      }
      flush();
      run = { weekdays: [day], sell: cell.sell, cost };
    }
    flush();
  }
  const surcharges: Surcharges = {
    extraAdult: priceOrNull(d.extraAdult),
    extraChild: priceOrNull(d.extraChild),
  };
  const packages = d.packages.map(packageInputOf);
  return { version, weekday, surcharges, ...(packages.length ? { packages } : {}) };
}

/**
 * The draft after the packages of one target changed. The first package of a target
 * takes over the target's plain prices; removing the last one gives its prices back to
 * the plain row. Cells of removed packages are dropped.
 */
export function withPackages(
  d: RatesDraft,
  unitId: string | null,
  next: PackageDraft[],
): RatesDraft {
  const before = packagesOf(d.packages, unitId);
  const plain = rowKey(unitId, null);
  const cells = { ...d.cells };
  if (before.length === 0 && next.length > 0 && next[0] && cells[plain]) {
    cells[next[0].key] = cells[plain];
    delete cells[plain];
  }
  if (before.length > 0 && next.length === 0) {
    const full = fullPackageKey(d.packages, unitId);
    if (full && cells[full]) cells[plain] = cells[full];
  }
  const kept = new Set(next.map((k) => k.key));
  for (const k of before) if (!kept.has(k.key)) delete cells[k.key];
  const others = d.packages.filter((k) => k.unitId !== unitId);
  return { ...d, packages: [...others, ...next], cells };
}
