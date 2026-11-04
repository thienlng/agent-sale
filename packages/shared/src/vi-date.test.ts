import { describe, expect, it } from 'vitest';

import { vietnameseDateLabel, vietnameseWeekday } from './vi-date.js';

describe('vietnameseWeekday', () => {
  it('names every weekday in the house style', () => {
    expect(
      [
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
        '2026-11-07',
        '2026-11-08',
      ].map(vietnameseWeekday),
    ).toEqual(['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']);
  });

  it('is empty for a value that is not a calendar date', () => {
    expect(vietnameseWeekday('2026-02-30')).toBe('');
    expect(vietnameseWeekday('mai')).toBe('');
  });
});

describe('vietnameseDateLabel', () => {
  it('writes the weekday then dd/mm/yyyy', () => {
    expect(vietnameseDateLabel('2026-11-07')).toBe('Thứ Bảy 07/11/2026');
    expect(vietnameseDateLabel('2026-11-08')).toBe('Chủ Nhật 08/11/2026');
    expect(vietnameseDateLabel('2028-02-29')).toBe('Thứ Ba 29/02/2028');
  });

  it('is null for a value that is not a calendar date', () => {
    expect(vietnameseDateLabel('')).toBeNull();
    expect(vietnameseDateLabel('2026-02-30')).toBeNull();
    expect(vietnameseDateLabel('07/11/2026')).toBeNull();
  });
});
