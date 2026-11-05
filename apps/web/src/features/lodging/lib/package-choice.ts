import type { PropertyDto, QuoteDto } from '@agent-sales/contracts';

import { targetPackages } from './units-model';

/** Packages staff chose in a booking form, per target key (`''` = the whole property). */
export type PackageChoice = Readonly<Record<string, string>>;

export const targetKey = (target: string | null): string => target ?? '';

/**
 * The targets of a stay selection that have packages, in the order the server prices them:
 * a whole rental is the whole property when it has its own packages or weekday prices,
 * otherwise every active room; a room selection is its rooms.
 */
export function packageTargets(
  p: PropertyDto | undefined,
  whole: boolean,
  unitIds: readonly string[],
): (string | null)[] {
  if (!p) return [];
  const has = (target: string | null) => p.packages.some((k) => k.unitId === target);
  const rooms = p.sellMode === 'rooms' ? p.units.filter((u) => u.kind === 'room') : [];
  if (!whole) return rooms.filter((u) => unitIds.includes(u.id) && has(u.id)).map((u) => u.id);
  if (p.sellMode === 'whole' || has(null)) return has(null) ? [null] : [];
  const wholePriced = p.rates.some((r) => r.kind === 'weekday' && r.unitId === null);
  return wholePriced ? [] : rooms.filter((u) => u.active && has(u.id)).map((u) => u.id);
}

/**
 * The package selects of a stay: once a quote exists, the targets it priced with packages (the
 * server decides per night, e.g. a whole-target override on a rooms property); before the first
 * quote, `packageTargets`. A previous selection's quote (kept while the next one loads) is
 * trimmed to the selected rooms.
 */
export function selectTargets(
  p: PropertyDto | undefined,
  whole: boolean,
  unitIds: readonly string[],
  quote: QuoteDto | undefined,
): (string | null)[] {
  if (!quote) return packageTargets(p, whole, unitIds);
  const used = [...new Set(quote.packages.map((k) => k.target))];
  return whole ? used : used.filter((t) => t !== null && unitIds.includes(t));
}

/** The packages a quote used, as a choice per target. */
export function quoteChoice(quote: QuoteDto): PackageChoice {
  return Object.fromEntries(quote.packages.map((k) => [targetKey(k.target), k.packageId]));
}

/** The chosen package ids of the shown targets (a target without a choice is auto-picked). */
export function choiceIds(choice: PackageChoice, targets: readonly (string | null)[]): string[] {
  return targets.flatMap((t) => {
    const id = choice[targetKey(t)];
    return id ? [id] : [];
  });
}

/** A booking's stored packages as a choice per target. */
export function choiceOf(p: PropertyDto | undefined, packageIds: readonly string[]): PackageChoice {
  const out: Record<string, string> = {};
  for (const k of p?.packages ?? []) if (packageIds.includes(k.id)) out[targetKey(k.unitId)] = k.id;
  return out;
}

/** The packages a target's select offers, most bedrooms first (as the rates matrix). */
export const packageOptions = (p: PropertyDto, target: string | null) =>
  [...targetPackages(p.packages, target)].sort(
    (a, b) => b.bedrooms - a.bedrooms || b.sortOrder - a.sortOrder,
  );

export const sameIdSet = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
