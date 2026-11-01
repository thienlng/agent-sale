import { describe, expect, it } from 'vitest';

import { LodgingError } from './lodging.errors.js';
import { isoWeekday, localToday, nightsBetween } from './nights.js';

describe('nightsBetween', () => {
  it('lists every night from check-in up to but excluding check-out', () => {
    expect(nightsBetween('2026-11-06', '2026-11-08')).toEqual(['2026-11-06', '2026-11-07']);
  });

  it('crosses month and year ends', () => {
    expect(nightsBetween('2026-12-31', '2027-01-02')).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('rejects a same-day or reversed stay', () => {
    expect(() => nightsBetween('2026-11-06', '2026-11-06')).toThrow(LodgingError);
    expect(() => nightsBetween('2026-11-08', '2026-11-06')).toThrow(LodgingError);
  });

  it('allows 60 nights and rejects 61', () => {
    expect(nightsBetween('2026-11-01', '2026-12-31')).toHaveLength(60);
    try {
      nightsBetween('2026-11-01', '2027-01-01');
      expect.unreachable();
    } catch (e) {
      expect((e as LodgingError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects malformed dates', () => {
    expect(() => nightsBetween('2027-02-30', '2027-03-02')).toThrow(LodgingError);
  });
});

describe('isoWeekday', () => {
  it('maps Sunday to 7 and Monday to 1', () => {
    expect(isoWeekday('2026-11-08')).toBe(7);
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-06')).toBe(5);
  });
});

describe('localToday', () => {
  it('uses Asia/Ho_Chi_Minh, not UTC', () => {
    expect(localToday(new Date('2026-11-01T18:30:00Z'))).toBe('2026-11-02');
    expect(localToday(new Date('2026-11-01T16:59:00Z'))).toBe('2026-11-01');
  });

  it('accepts another time zone', () => {
    expect(localToday(new Date('2026-11-01T18:30:00Z'), 'UTC')).toBe('2026-11-01');
  });
});
