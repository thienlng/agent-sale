import { describe, expect, it } from 'vitest';

import {
  addDays,
  formatShortVnd,
  isoWeekday,
  isStayRange,
  nightList,
  nightsBetween,
} from './format';

describe('lodging format', () => {
  it('shortens cell prices', () => {
    expect(formatShortVnd(12_000_000)).toBe('12tr');
    expect(formatShortVnd(1_200_000)).toBe('1,2tr');
    expect(formatShortVnd(850_000)).toBe('850k');
  });

  it('does night arithmetic on calendar dates', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(nightsBetween('2026-11-02', '2026-11-05')).toBe(3);
    expect(nightList('2026-11-02', '2026-11-04')).toEqual(['2026-11-02', '2026-11-03']);
    expect(isoWeekday('2026-11-02')).toBe(1);
    expect(isoWeekday('2026-11-08')).toBe(7);
  });

  it('accepts stays of 1 to 60 nights only', () => {
    expect(isStayRange('2026-11-02', '2026-11-02')).toBe(false);
    expect(isStayRange('2026-11-02', '2026-11-03')).toBe(true);
    expect(isStayRange('2026-11-01', '2026-12-31')).toBe(true);
    expect(isStayRange('2026-11-01', '2027-01-01')).toBe(false);
    expect(isStayRange('', '2026-11-03')).toBe(false);
  });
});
