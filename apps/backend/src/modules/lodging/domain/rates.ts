import { LodgingError } from './lodging.errors.js';
import { isoWeekday } from './nights.js';

/**
 * One price rule. `unitId` null = the whole property; override dates are inclusive nights.
 * `packageId` names the bedroom package of the target it prices (null = no package).
 */
export interface RateRule {
  id: string;
  unitId: string | null;
  kind: 'weekday' | 'override';
  weekdays: number[];
  dateFrom: string | null;
  dateTo: string | null;
  label: string;
  sell: number;
  cost: number;
  minNights: number | null;
  packageId: string | null;
}

/** A bedroom package of one target (`unitId` null = the whole property). */
export interface DomainPackage {
  id: string;
  unitId: string | null;
  name: string;
  bedrooms: number;
  standardAdults: number;
  standardChildren: number;
  maxGuests: number | null;
  sortOrder: number;
}

export const MAX_PACKAGES_PER_TARGET = 10;

export interface NightPrice {
  sell: number;
  cost: number;
  label: string;
  minNights: number | null;
}

const isWeekday = (d: number) => Number.isInteger(d) && d >= 1 && d <= 7;

/** Weekdays of the weekday rules of one (target, package). */
function weekdaysOf(rules: RateRule[], target: string | null, packageId: string | null): number[] {
  return rules
    .filter((r) => r.kind === 'weekday' && r.unitId === target && r.packageId === packageId)
    .flatMap((r) => r.weekdays);
}

/** The packages of one target. */
export function packagesOf(packages: DomainPackage[], target: string | null): DomainPackage[] {
  return packages.filter((p) => p.unitId === target);
}

/** The full package of a target: most bedrooms; a tie goes to the later `sortOrder`. */
export function fullPackage(
  packages: DomainPackage[],
  target: string | null,
): DomainPackage | undefined {
  let best: DomainPackage | undefined;
  for (const p of packagesOf(packages, target)) {
    if (
      !best ||
      p.bedrooms > best.bedrooms ||
      (p.bedrooms === best.bedrooms && p.sortOrder > best.sortOrder)
    ) {
      best = p;
    }
  }
  return best;
}

/**
 * Each target (null = whole property, or a room id) prices weekdays 1..7 exactly once with
 * its package-less weekday rates.
 */
export function assertWeekdayCoverage(rules: RateRule[], targets: (string | null)[]): void {
  for (const target of targets) {
    const days = weekdaysOf(rules, target, null);
    const complete = days.length === 7 && new Set(days).size === 7 && days.every(isWeekday);
    if (!complete) {
      throw new LodgingError('VALIDATION_FAILED', 'Each weekday must be priced exactly once', {
        unitId: target,
        weekdays: days,
      });
    }
  }
}

/**
 * Rate coverage per target. Without packages: `assertWeekdayCoverage`, and no rate may name a
 * package. With packages: every rate names one of the target's packages, the full package
 * prices weekdays 1..7 exactly once, every other package prices each weekday at most once.
 */
export function assertRateCoverage(
  rules: RateRule[],
  targets: (string | null)[],
  packages: DomainPackage[],
): void {
  for (const target of targets) {
    const own = packagesOf(packages, target);
    const ids = new Set(own.map((p) => p.id));
    for (const r of rules) {
      if (r.unitId !== target) continue;
      const known = own.length === 0 ? r.packageId === null : ids.has(r.packageId ?? '');
      if (!known) {
        throw new LodgingError(
          'VALIDATION_FAILED',
          own.length === 0
            ? 'A rate names a package its target does not have'
            : 'Every rate of a target with packages must name one of its packages',
          { unitId: target, packageId: r.packageId, weekdays: r.weekdays },
        );
      }
    }
    const full = fullPackage(packages, target);
    if (!full) {
      assertWeekdayCoverage(rules, [target]);
      continue;
    }
    for (const p of own) {
      const days = weekdaysOf(rules, target, p.id);
      const distinct = new Set(days).size === days.length && days.every(isWeekday);
      const ok = p.id === full.id ? distinct && days.length === 7 : distinct;
      if (!ok) {
        throw new LodgingError(
          'VALIDATION_FAILED',
          p.id === full.id
            ? 'The full package must price each weekday exactly once'
            : 'A package prices each weekday at most once',
          { unitId: target, packageId: p.id, weekdays: days },
        );
      }
    }
  }
}

/**
 * Packages of a property: each target is one of `targets`, at most 10 per target, bedrooms
 * strictly differ and names differ (ignoring case) within a target.
 */
export function assertPackages(packages: DomainPackage[], targets: (string | null)[]): void {
  for (const p of packages) {
    if (!targets.includes(p.unitId)) {
      throw new LodgingError('VALIDATION_FAILED', 'A package belongs to an unknown target', {
        unitId: p.unitId,
        packageId: p.id,
      });
    }
  }
  for (const target of targets) {
    const own = packagesOf(packages, target);
    if (own.length > MAX_PACKAGES_PER_TARGET) {
      throw new LodgingError('VALIDATION_FAILED', 'Too many packages for one target', {
        unitId: target,
        max: MAX_PACKAGES_PER_TARGET,
      });
    }
    const bedrooms = new Set<number>();
    const names = new Set<string>();
    for (const p of own) {
      const name = p.name.trim().toLowerCase();
      if (bedrooms.has(p.bedrooms)) {
        throw new LodgingError('VALIDATION_FAILED', 'Two packages have the same bedrooms', {
          unitId: target,
          packageId: p.id,
          bedrooms: p.bedrooms,
        });
      }
      if (names.has(name)) {
        throw new LodgingError('VALIDATION_FAILED', 'Two packages have the same name', {
          unitId: target,
          packageId: p.id,
          name: p.name,
        });
      }
      bedrooms.add(p.bedrooms);
      names.add(name);
    }
  }
}

/**
 * Overrides of one (target, package) never overlap (inclusive ranges) and never run backwards.
 */
export function assertNoOverrideOverlap(rules: RateRule[]): void {
  const ranges = rules
    .filter((r) => r.kind === 'override')
    .map((r) => {
      if (!r.dateFrom || !r.dateTo || r.dateFrom > r.dateTo) {
        throw new LodgingError('VALIDATION_FAILED', 'An override needs dateFrom ≤ dateTo', {
          rateId: r.id,
        });
      }
      return {
        id: r.id,
        unitId: r.unitId,
        packageId: r.packageId,
        from: r.dateFrom,
        to: r.dateTo,
      };
    });
  ranges.forEach((a, i) => {
    for (const b of ranges.slice(i + 1)) {
      const same = a.unitId === b.unitId && a.packageId === b.packageId;
      if (same && a.from <= b.to && b.from <= a.to) {
        throw new LodgingError('VALIDATION_FAILED', 'Date-range prices overlap', {
          rateIds: [a.id, b.id],
        });
      }
    }
  });
}

/**
 * Price of one night for one (target, package): a matching override wins over the weekday
 * rate. `null` = not priced (for a package: not sold that night).
 */
export function priceNight(
  rules: RateRule[],
  unitId: string | null,
  night: string,
  packageId: string | null = null,
): NightPrice | null {
  const own = rules.filter((r) => r.unitId === unitId && r.packageId === packageId);
  const weekday = isoWeekday(night);
  const hit =
    own.find(
      (r) =>
        r.kind === 'override' &&
        r.dateFrom !== null &&
        r.dateTo !== null &&
        r.dateFrom <= night &&
        night <= r.dateTo,
    ) ?? own.find((r) => r.kind === 'weekday' && r.weekdays.includes(weekday));
  if (!hit) return null;
  return {
    sell: hit.sell,
    cost: hit.cost,
    label: hit.kind === 'override' ? hit.label : '',
    minNights: hit.kind === 'override' ? hit.minNights : null,
  };
}

/**
 * One rate's package fits its target: a package of that same target, and none on a target
 * without packages; a target with packages needs one (`assertRateCoverage` per rate).
 */
export function assertRatePackage(rule: RateRule, packages: DomainPackage[]): void {
  const own = packagesOf(packages, rule.unitId);
  const ok = own.length === 0 ? rule.packageId === null : own.some((p) => p.id === rule.packageId);
  if (!ok) {
    throw new LodgingError(
      'VALIDATION_FAILED',
      own.length === 0
        ? 'A rate names a package its target does not have'
        : 'Every rate of a target with packages must name one of its packages',
      { unitId: rule.unitId, packageId: rule.packageId },
    );
  }
}

/**
 * The night's price of a target as the calendar and the catalog show it: its full package's
 * price when it has packages, else its package-less price.
 */
export function priceFull(
  rules: RateRule[],
  packages: DomainPackage[],
  target: string | null,
  night: string,
): NightPrice | null {
  return priceNight(rules, target, night, fullPackage(packages, target)?.id ?? null);
}
