import { describe, expect, it } from 'vitest';

import { resolvePeriod } from '../domain/report-period.js';

// 2026-11-04 10:00 local (Wednesday) = 03:00Z.
const wed = new Date('2026-11-04T03:00:00Z');
const iso = (p: ReturnType<typeof resolvePeriod>) => ({
  from: p.from,
  to: p.to,
  since: p.since.toISOString(),
  until: p.until.toISOString(),
});

describe('resolvePeriod', () => {
  it('day', () => {
    expect(iso(resolvePeriod('day', 'previous', wed))).toEqual({
      from: '2026-11-03',
      to: '2026-11-03',
      since: '2026-11-02T17:00:00.000Z',
      until: '2026-11-03T17:00:00.000Z',
    });
    expect(iso(resolvePeriod('day', 'to_date', wed))).toEqual({
      from: '2026-11-04',
      to: '2026-11-04',
      since: '2026-11-03T17:00:00.000Z',
      until: '2026-11-04T03:00:00.000Z',
    });
  });

  it('week runs Monday to Sunday', () => {
    expect(iso(resolvePeriod('week', 'previous', wed))).toEqual({
      from: '2026-10-26',
      to: '2026-11-01',
      since: '2026-10-25T17:00:00.000Z',
      until: '2026-11-01T17:00:00.000Z',
    });
    expect(iso(resolvePeriod('week', 'to_date', wed)).from).toBe('2026-11-02');
    // On a Monday at 00:30 local, the previous week just ended.
    const monday = new Date('2026-11-01T17:30:00Z');
    expect(resolvePeriod('week', 'previous', monday)).toMatchObject({
      from: '2026-10-26',
      to: '2026-11-01',
    });
    expect(resolvePeriod('week', 'to_date', monday)).toMatchObject({
      from: '2026-11-02',
      to: '2026-11-02',
    });
  });

  it('month is the calendar month, including on the 1st', () => {
    expect(iso(resolvePeriod('month', 'previous', wed))).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      since: '2026-09-30T17:00:00.000Z',
      until: '2026-10-31T17:00:00.000Z',
    });
    const first = new Date('2026-12-31T18:00:00Z'); // 2027-01-01 01:00 local
    expect(resolvePeriod('month', 'previous', first)).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(resolvePeriod('month', 'to_date', first)).toMatchObject({
      from: '2027-01-01',
      to: '2027-01-01',
    });
  });
});
