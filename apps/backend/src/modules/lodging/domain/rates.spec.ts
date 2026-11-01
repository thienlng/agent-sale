import { describe, expect, it } from 'vitest';

import { LodgingError } from './lodging.errors.js';
import { assertNoOverrideOverlap, assertWeekdayCoverage, priceNight } from './rates.js';
import { override, weekday } from '../__tests__/factories/rate-rules.js';

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
