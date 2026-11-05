import { describe, expect, it } from 'vitest';

import { auraPackages, auraRates, pkg } from '../__tests__/factories/packages.js';
import { forPackage, override, weekday } from '../__tests__/factories/rate-rules.js';
import type { PropertyRecord, UnitRecord } from './ports/lodging-store.js';
import { weekdaySell } from './property-support.js';

const prop = (sellMode: 'whole' | 'rooms') => ({ id: 'p', sellMode }) as PropertyRecord;
const room = (id: string, active = true) =>
  ({ id, propertyId: 'p', kind: 'room', active }) as UnitRecord;

describe('weekdaySell', () => {
  it('reads the whole-property weekday rates, Monday first, ignoring overrides', () => {
    const rules = [
      weekday(null, [1, 2, 3, 4], 13_200_000),
      weekday(null, [5, 7], 15_400_000),
      weekday(null, [6], 17_600_000),
      override(null, '2026-12-31', '2027-01-01', 30_000_000),
    ];
    expect(weekdaySell(prop('whole'), [], rules)).toEqual([
      13_200_000, 13_200_000, 13_200_000, 13_200_000, 15_400_000, 17_600_000, 15_400_000,
    ]);
  });
  it('is null on every weekday of an unpriced property', () => {
    expect(weekdaySell(prop('whole'), [], [])).toEqual(Array(7).fill(null));
  });
  it('sums the active rooms of a room-sold property without a whole rate', () => {
    const units = [room('r1'), room('r2'), room('r3', false)];
    const rules = [
      weekday('r1', [1, 2, 3, 4, 5, 6, 7], 500_000),
      weekday('r2', [1, 2, 3, 4, 5, 6], 700_000),
    ];
    expect(weekdaySell(prop('rooms'), units, rules)).toEqual([
      1_200_000,
      1_200_000,
      1_200_000,
      1_200_000,
      1_200_000,
      1_200_000,
      null,
    ]);
    const whole = [...rules, weekday(null, [1, 2, 3, 4, 5, 6, 7], 1_000_000)];
    expect(weekdaySell(prop('rooms'), units, whole)[6]).toBe(1_000_000);
  });
  it('prices a whole property with packages by its full package (T-193)', () => {
    expect(weekdaySell(prop('whole'), [], auraRates(), auraPackages)).toEqual([
      10_000_000, 10_000_000, 10_000_000, 10_000_000, 12_000_000, 18_000_000, 12_000_000,
    ]);
  });
  it('sums the full package of each room that has packages', () => {
    const units = [room('r1'), room('r2')];
    const rules = [
      forPackage('r1-2', weekday('r1', [1, 2, 3, 4, 5, 6, 7], 900_000)),
      forPackage('r1-1', weekday('r1', [1, 2, 3, 4, 5, 6, 7], 500_000)),
      weekday('r2', [1, 2, 3, 4, 5, 6, 7], 700_000),
    ];
    const packages = [pkg('r1-2', 'r1', 2), pkg('r1-1', 'r1', 1)];
    expect(weekdaySell(prop('rooms'), units, rules, packages)[0]).toBe(1_600_000);
  });
});
