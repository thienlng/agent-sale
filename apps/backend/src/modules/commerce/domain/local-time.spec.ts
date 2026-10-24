import { describe, expect, it } from 'vitest';

import { datesBetween, localDate, startOfLocalDay } from './local-time.js';

describe('local time helpers', () => {
  it('maps a Vietnamese calendar day to its UTC start (UTC+7)', () => {
    expect(startOfLocalDay('2026-10-24', 'Asia/Ho_Chi_Minh').toISOString()).toBe(
      '2026-10-23T17:00:00.000Z',
    );
  });

  it('finds the local date of an instant near midnight', () => {
    expect(localDate(new Date('2026-10-23T17:30:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-24');
    expect(localDate(new Date('2026-10-23T16:59:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-23');
  });

  it('handles DST zones', () => {
    // New York switches to DST on 2026-03-08: midnight is still UTC−5 that day.
    expect(startOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(startOfLocalDay('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });

  it('lists inclusive date ranges across months', () => {
    expect(datesBetween('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });
});
