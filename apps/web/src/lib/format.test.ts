import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateTime,
  formatPhone,
  formatRelativeTime,
  formatShortDate,
} from './format';

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-11-01T10:00:00.000Z');

  it('says how long ago an instant was, in the largest whole unit', () => {
    expect(formatRelativeTime('2026-11-01T09:58:00.000Z', now)).toBe('2 phút trước');
    expect(formatRelativeTime('2026-11-01T07:00:00.000Z', now)).toBe('3 giờ trước');
    expect(formatRelativeTime('2026-10-30T10:00:00.000Z', now)).toBe('2 ngày trước');
  });

  it('reads a just-now or future instant as now', () => {
    expect(formatRelativeTime('2026-11-01T10:00:05.000Z', now)).toBe('bây giờ');
  });
});

describe('formatShortDate', () => {
  it('drops the year inside the current year and keeps it outside (VL-A8)', () => {
    expect(formatShortDate('2026-03-05', '2026-11-13')).toBe('05/03');
    expect(formatShortDate('2027-01-01', '2026-11-13')).toBe('01/01/2027');
    expect(formatShortDate('2025-12-31', '2026-11-13')).toBe('31/12/2025');
  });
});

describe('formatPhone', () => {
  it('writes Vietnamese numbers the local way (LM-5)', () => {
    expect(formatPhone('+84912000111')).toBe('0912 000 111');
    expect(formatPhone('0912000111')).toBe('0912 000 111');
    expect(formatPhone('+842438123456')).toBe('024 3812 3456');
  });
  it('keeps other numbers as stored', () => {
    expect(formatPhone('+14155550123')).toBe('+14155550123');
    expect(formatPhone('1900')).toBe('1900');
  });
});

describe('date formats (AS-23)', () => {
  it('writes days as dd/mm and times with the full year', () => {
    expect(formatDate('2026-11-07')).toBe('07/11');
    expect(formatDateTime('2026-11-13T01:05:00')).toMatch(/01:05.*13\/11\/2026/);
  });
});
