import { describe, expect, it } from 'vitest';

import { isMissed, nextRunAt, nextRuns } from '../domain/cadence.js';

/** Local time is UTC+7: 08:00 local = 01:00Z. */
const at = (iso: string) => new Date(iso);
const next = (c: Parameters<typeof nextRunAt>[0], after: string) =>
  nextRunAt(c, at(after)).toISOString();

describe('nextRunAt', () => {
  it('daily: today before `at`, tomorrow after it, strictly after', () => {
    const daily = { kind: 'daily' as const, at: '08:00' };
    expect(next(daily, '2026-11-02T00:30:00Z')).toBe('2026-11-02T01:00:00.000Z');
    expect(next(daily, '2026-11-02T01:30:00Z')).toBe('2026-11-03T01:00:00.000Z');
    expect(next(daily, '2026-11-02T01:00:00Z')).toBe('2026-11-03T01:00:00.000Z');
    // 23:30 local the day before (16:30Z) → 08:00 local.
    expect(next(daily, '2026-11-01T16:30:00Z')).toBe('2026-11-02T01:00:00.000Z');
  });

  it('weekly: wraps to next week', () => {
    // 2026-11-02 is a Monday.
    const mon = { kind: 'weekly' as const, days: [1], at: '08:00' };
    expect(next(mon, '2026-11-02T00:00:00Z')).toBe('2026-11-02T01:00:00.000Z');
    expect(next(mon, '2026-11-02T02:00:00Z')).toBe('2026-11-09T01:00:00.000Z');
    const weekend = { kind: 'weekly' as const, days: [6, 7], at: '20:00' };
    expect(next(weekend, '2026-11-02T00:00:00Z')).toBe('2026-11-07T13:00:00.000Z');
    expect(next(weekend, '2026-11-07T13:00:00Z')).toBe('2026-11-08T13:00:00.000Z');
  });

  it('monthly: the last day in February and in a leap year, and day 28', () => {
    const last = { kind: 'monthly' as const, day: -1, at: '21:00' };
    expect(next(last, '2027-02-10T00:00:00Z')).toBe('2027-02-28T14:00:00.000Z');
    expect(next(last, '2028-02-10T00:00:00Z')).toBe('2028-02-29T14:00:00.000Z');
    expect(next(last, '2028-02-29T14:00:00Z')).toBe('2028-03-31T14:00:00.000Z');
    const d28 = { kind: 'monthly' as const, day: 28, at: '08:00' };
    expect(next(d28, '2026-11-28T02:00:00Z')).toBe('2026-12-28T01:00:00.000Z');
    expect(next(d28, '2026-12-28T02:00:00Z')).toBe('2027-01-28T01:00:00.000Z');
  });

  it('every: aligned to local midnight, and active hours across midnight', () => {
    const quarter = { kind: 'every' as const, minutes: 15 };
    expect(next(quarter, '2026-11-02T01:07:00Z')).toBe('2026-11-02T01:15:00.000Z');
    expect(next(quarter, '2026-11-02T01:15:00Z')).toBe('2026-11-02T01:30:00.000Z');
    const night = { kind: 'every' as const, minutes: 60, activeFrom: '22:00', activeTo: '02:00' };
    // 21:30 local → 22:00 local (15:00Z).
    expect(next(night, '2026-11-02T14:30:00Z')).toBe('2026-11-02T15:00:00.000Z');
    // 01:30 local the next day → 02:00 local (19:00Z), then 22:00 local.
    expect(next(night, '2026-11-02T18:30:00Z')).toBe('2026-11-02T19:00:00.000Z');
    expect(next(night, '2026-11-02T19:00:00Z')).toBe('2026-11-03T15:00:00.000Z');
    const day = { kind: 'every' as const, minutes: 120, activeFrom: '08:00', activeTo: '18:00' };
    expect(nextRuns(day, at('2026-11-02T10:30:00Z'), 3).map((d) => d.toISOString())).toEqual([
      '2026-11-02T11:00:00.000Z',
      '2026-11-03T01:00:00.000Z',
      '2026-11-03T03:00:00.000Z',
    ]);
  });

  it('marks a slot over 6 h late as missed', () => {
    const slot = at('2026-11-02T01:00:00Z');
    expect(isMissed(slot, at('2026-11-02T07:00:00Z'))).toBe(false);
    expect(isMissed(slot, at('2026-11-02T07:00:01Z'))).toBe(true);
  });
});
