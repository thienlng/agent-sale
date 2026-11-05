import { describe, expect, it } from 'vitest';

import { LodgingError } from './lodging.errors.js';
import {
  assertNoOverrideOverlap,
  assertPackages,
  assertRateCoverage,
  assertRatePackage,
  assertWeekdayCoverage,
  fullPackage,
  priceFull,
  priceNight,
} from './rates.js';
import { auraPackages, auraRates, pkg } from '../__tests__/factories/packages.js';
import { forPackage, override, weekday } from '../__tests__/factories/rate-rules.js';

const a17 = [
  weekday(null, [1, 2, 3, 4], 12_000_000),
  weekday(null, [5, 7], 13_000_000),
  weekday(null, [6], 14_000_000),
];

function code(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof LodgingError) return e.code;
    throw e;
  }
  return undefined;
}

function details(fn: () => void): Record<string, unknown> | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof LodgingError) return e.details;
    throw e;
  }
  return undefined;
}

describe('assertWeekdayCoverage', () => {
  it('passes when every weekday is priced exactly once', () => {
    expect(() => assertWeekdayCoverage(a17, [null])).not.toThrow();
  });

  it('fails when a weekday is missing', () => {
    const rules = [
      weekday(null, [1, 2, 3, 4], 12_000_000),
      weekday(null, [5], 13_000_000),
      weekday(null, [6], 14_000_000),
    ];
    expect(code(() => assertWeekdayCoverage(rules, [null]))).toBe('VALIDATION_FAILED');
  });

  it('fails when a weekday is priced twice', () => {
    const rules = [...a17, weekday(null, [5], 15_000_000)];
    expect(code(() => assertWeekdayCoverage(rules, [null]))).toBe('VALIDATION_FAILED');
  });

  it('checks every target separately', () => {
    const rules = [weekday('p1', [1, 2, 3, 4, 5, 6, 7], 1), weekday('p2', [1, 2, 3], 1)];
    expect(code(() => assertWeekdayCoverage(rules, ['p1', 'p2']))).toBe('VALIDATION_FAILED');
    expect(() => assertWeekdayCoverage(rules, ['p1'])).not.toThrow();
  });
});

describe('assertNoOverrideOverlap', () => {
  it('fails for overlapping overrides of the same unit (inclusive dates)', () => {
    const rules = [
      override('p1', '2026-12-30', '2027-01-02', 1),
      override('p1', '2027-01-01', '2027-01-03', 1),
    ];
    expect(code(() => assertNoOverrideOverlap(rules))).toBe('VALIDATION_FAILED');
  });

  it('fails when one range ends on the night the other starts', () => {
    const rules = [
      override(null, '2027-01-01', '2027-01-02', 1),
      override(null, '2027-01-02', '2027-01-05', 1),
    ];
    expect(code(() => assertNoOverrideOverlap(rules))).toBe('VALIDATION_FAILED');
  });

  it('compares overrides per (target, package)', () => {
    const a = forPackage('pk6', override(null, '2027-01-01', '2027-01-03', 1));
    const b = forPackage('pk5', override(null, '2027-01-02', '2027-01-04', 1));
    expect(() => assertNoOverrideOverlap([a, b])).not.toThrow();
    const c = forPackage('pk6', override(null, '2027-01-03', '2027-01-04', 1));
    expect(code(() => assertNoOverrideOverlap([a, c]))).toBe('VALIDATION_FAILED');
    expect(() =>
      assertNoOverrideOverlap([a, override(null, '2027-01-01', '2027-01-01', 1)]),
    ).not.toThrow();
  });

  it('passes for different units and for adjacent ranges', () => {
    expect(() =>
      assertNoOverrideOverlap([
        override('p1', '2026-12-30', '2027-01-02', 1),
        override('p2', '2027-01-01', '2027-01-03', 1),
      ]),
    ).not.toThrow();
    expect(() =>
      assertNoOverrideOverlap([
        override(null, '2027-01-01', '2027-01-02', 1),
        override(null, '2027-01-03', '2027-01-05', 1),
      ]),
    ).not.toThrow();
  });

  it('rejects a range that ends before it starts', () => {
    expect(
      code(() => assertNoOverrideOverlap([override(null, '2027-01-05', '2027-01-01', 1)])),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('priceNight', () => {
  it('uses the weekday rate of the night', () => {
    expect(priceNight(a17, null, '2026-11-07')).toEqual({
      sell: 14_000_000,
      cost: 14_000_000,
      label: '',
      minNights: null,
    });
  });

  it('lets an override win over the weekday rate', () => {
    const rules = [...a17, override(null, '2027-02-05', '2027-02-08', 20_000_000, 'Tết', 2)];
    expect(priceNight(rules, null, '2027-02-08')).toEqual({
      sell: 20_000_000,
      cost: 20_000_000,
      label: 'Tết',
      minNights: 2,
    });
    expect(priceNight(rules, null, '2027-02-09')?.sell).toBe(12_000_000); // Tuesday
  });

  it('only uses rules of the requested target', () => {
    expect(priceNight(a17, 'p1', '2026-11-07')).toBeNull();
  });
});

describe('priceNight with packages', () => {
  it('prices only the rules of the requested package', () => {
    expect(priceNight(auraRates(), null, '2026-11-07', 'pk6')?.sell).toBe(18_000_000);
    expect(priceNight(auraRates(), null, '2026-11-07', 'pk5')?.sell).toBe(16_000_000);
    expect(priceNight(auraRates(), null, '2026-11-07', 'pk4')).toBeNull(); // not sold Saturday
    expect(priceNight(auraRates(), null, '2026-11-07')).toBeNull(); // no package-less rate
  });

  it('lets an override of a package win, even on a weekday it does not sell', () => {
    const rules = [
      ...auraRates(),
      forPackage('pk4', override(null, '2026-11-07', '2026-11-07', 9)),
    ];
    expect(priceNight(rules, null, '2026-11-07', 'pk4')?.sell).toBe(9);
    expect(priceNight(rules, null, '2026-11-07', 'pk5')?.sell).toBe(16_000_000);
  });
});

describe('fullPackage', () => {
  it('takes the most bedrooms of the target', () => {
    expect(fullPackage(auraPackages, null)?.id).toBe('pk6');
    expect(fullPackage(auraPackages, 'r1')).toBeUndefined();
  });

  it('breaks a bedroom tie with the later sort order', () => {
    const packages = [pkg('a', 'r1', 3, { sortOrder: 2 }), pkg('b', 'r1', 3, { sortOrder: 5 })];
    expect(fullPackage(packages, 'r1')?.id).toBe('b');
  });
});

describe('assertRateCoverage', () => {
  it('keeps the package-less rule when a target has no packages', () => {
    expect(() => assertRateCoverage(a17, [null], [])).not.toThrow();
    expect(code(() => assertRateCoverage(a17.slice(1), [null], []))).toBe('VALIDATION_FAILED');
  });

  it('refuses a rate naming a package on a target without packages', () => {
    const rules = [...a17, forPackage('pk6', weekday(null, [1], 1))];
    expect(code(() => assertRateCoverage(rules, [null], []))).toBe('VALIDATION_FAILED');
  });

  it('accepts packages where only the full one covers every weekday', () => {
    expect(() => assertRateCoverage(auraRates(), [null], auraPackages)).not.toThrow();
  });

  it('refuses a package-less rate on a target with packages', () => {
    const rules = [...auraRates(), weekday(null, [6], 1)];
    expect(details(() => assertRateCoverage(rules, [null], auraPackages))).toEqual({
      unitId: null,
      packageId: null,
      weekdays: [6],
    });
  });

  it('refuses a rate naming a package of another target', () => {
    const rules = [...auraRates(), forPackage('x', weekday(null, [6], 1))];
    expect(code(() => assertRateCoverage(rules, [null], auraPackages))).toBe('VALIDATION_FAILED');
  });

  it('needs the full package to cover every weekday', () => {
    const rules = auraRates().filter((r) => !(r.packageId === 'pk6' && r.weekdays[0] === 6));
    expect(details(() => assertRateCoverage(rules, [null], auraPackages))).toEqual({
      unitId: null,
      packageId: 'pk6',
      weekdays: [1, 2, 3, 4, 5, 7],
    });
  });

  it('lets another package price a weekday at most once', () => {
    const rules = [...auraRates(), forPackage('pk4', weekday(null, [5], 1))];
    expect(details(() => assertRateCoverage(rules, [null], auraPackages))).toEqual({
      unitId: null,
      packageId: 'pk4',
      weekdays: [1, 2, 3, 4, 5, 7, 5],
    });
  });

  it('checks each target with its own packages', () => {
    const rules = [
      forPackage('r1a', weekday('r1', [1, 2, 3, 4, 5, 6, 7], 1)),
      weekday('r2', [1, 2, 3, 4, 5, 6, 7], 1),
    ];
    const packages = [pkg('r1a', 'r1', 2)];
    expect(() => assertRateCoverage(rules, ['r1', 'r2'], packages)).not.toThrow();
  });
});

describe('assertPackages', () => {
  it('accepts the Aura packages', () => {
    expect(() => assertPackages(auraPackages, [null])).not.toThrow();
  });

  it('refuses a package of an unknown target', () => {
    expect(code(() => assertPackages(auraPackages, ['r1']))).toBe('VALIDATION_FAILED');
  });

  it('refuses more than 10 packages per target', () => {
    const many = Array.from({ length: 11 }, (_, i) => pkg(`p${i}`, null, i + 1, { name: `n${i}` }));
    expect(code(() => assertPackages(many, [null]))).toBe('VALIDATION_FAILED');
    expect(() => assertPackages(many.slice(0, 10), [null])).not.toThrow();
  });

  it('refuses equal bedrooms within a target but allows them across targets', () => {
    expect(
      code(() => assertPackages([pkg('a', null, 3), pkg('b', null, 3, { name: 'B' })], [null])),
    ).toBe('VALIDATION_FAILED');
    expect(() =>
      assertPackages([pkg('a', 'r1', 3), pkg('b', 'r2', 3)], ['r1', 'r2']),
    ).not.toThrow();
  });

  it('refuses names equal ignoring case within a target', () => {
    const packages = [pkg('a', null, 3, { name: 'Full' }), pkg('b', null, 4, { name: 'full' })];
    expect(code(() => assertPackages(packages, [null]))).toBe('VALIDATION_FAILED');
  });
});

describe('priceFull', () => {
  it('prices a target with packages with its full package', () => {
    expect(priceFull(auraRates(), auraPackages, null, '2026-11-07')?.sell).toBe(18_000_000);
  });
  it('prices a target without packages with its package-less rules', () => {
    expect(priceFull(a17, auraPackages, null, '2026-11-07')).toBeNull();
    expect(priceFull(a17, [], null, '2026-11-07')?.sell).toBe(14_000_000);
  });
});

describe('assertRatePackage', () => {
  it('accepts a package of the same target and no package on a target without any', () => {
    expect(
      code(() => assertRatePackage(forPackage('pk5', weekday(null, [1], 1)), auraPackages)),
    ).toBeUndefined();
    expect(code(() => assertRatePackage(weekday('r1', [1], 1), auraPackages))).toBeUndefined();
  });
  it('refuses a foreign package, an unknown one and no package on a packaged target', () => {
    for (const rule of [
      forPackage('pk5', weekday('r1', [1], 1)),
      forPackage('nope', weekday(null, [1], 1)),
      weekday(null, [1], 1),
    ]) {
      expect(code(() => assertRatePackage(rule, auraPackages))).toBe('VALIDATION_FAILED');
    }
  });
});
