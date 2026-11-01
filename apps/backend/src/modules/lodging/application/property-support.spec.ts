import { describe, expect, it } from 'vitest';

import { override, weekday } from '../__tests__/factories/rate-rules.js';
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
});
