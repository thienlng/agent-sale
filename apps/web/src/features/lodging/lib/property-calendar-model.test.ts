import type { CalendarDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import type { CalendarRowData } from './calendar-model';
import { nightsBetween } from './format';
import {
  addMonths,
  compactSearch,
  dayInfos,
  monthOccupancy,
  monthWeeks,
  rangeStats,
  stayEvents,
  viewWindow,
  visibleNights,
} from './property-calendar-model';

type Segment = CalendarRowData['segments'][number];

const seg = (over: Partial<Segment>): Segment => ({
  bookingId: '0193a000-0000-7000-8000-000000000101',
  code: 'BK-0001',
  kind: 'stay',
  status: 'confirmed',
  from: '2026-11-06',
  to: '2026-11-08',
  guestName: 'Anh Nam',
  blockReason: '',
  holdExpiresAt: null,
  guestPhone: '',
  party: { adults: 2, childAges: [] },
  totalSell: 26_000_000,
  tags: [],
  note: '',
  packageNames: [],
  ...over,
});

const row = (unitId: string, segments: Segment[]): CalendarRowData => ({
  unitId,
  name: unitId,
  kind: 'room',
  prices: [],
  segments,
});

describe('property calendar model', () => {
  it('moves by months across years', () => {
    expect(addMonths('2026-11-17', 1)).toBe('2026-12-01');
    expect(addMonths('2026-11-17', 2)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
    expect(addMonths('2026-11-01', 12)).toBe('2027-11-01');
  });

  it('lays a month out in Monday-first weeks with the adjacent days', () => {
    const weeks = monthWeeks('2026-11-01');
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[0]).toBe('2026-10-26');
    expect(weeks[5]?.[6]).toBe('2026-12-06');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // February 2027 starts on a Monday and needs exactly four weeks.
    expect(monthWeeks('2027-02-10')).toHaveLength(4);
  });

  it('asks for at most 371 nights in any view', () => {
    expect(viewWindow('month', '2026-11-20')).toEqual({ from: '2026-10-25', to: '2026-12-07' });
    expect(viewWindow('quarter', '2026-11-20')).toEqual({ from: '2026-10-31', to: '2027-02-01' });
    const year = viewWindow('year', '2027-03-05');
    expect(year).toEqual({ from: '2027-02-28', to: '2028-03-01' });
    expect(nightsBetween(year.from, year.to)).toBeLessThanOrEqual(371);
    expect(visibleNights('month', '2026-11-20')).toHaveLength(30);
  });

  it('counts occupancy over every unit-night and each booking total once', () => {
    const whole = seg({ status: 'checked_in', from: '2026-10-30', to: '2026-11-03' });
    const rows = [
      row('a', [
        whole,
        seg({ bookingId: 'b2', status: 'hold', from: '2026-11-10', to: '2026-11-12' }),
      ]),
      row('b', [whole]),
    ];
    const stats = rangeStats(rows, visibleNights('month', '2026-11-01'));
    // Nights 01–02/11 on both rooms + two hold nights on one room = 6 of 60.
    expect(stats).toMatchObject({ takenNights: 6, totalNights: 60, pct: 10 });
    // Sold nights skip the hold; the whole-place stay is one booking.
    expect(stats.nightsSold).toBe(4);
    expect(stats.revenue).toBe(26_000_000);
  });

  it('gives a room its even share of a multi-room or whole-place total', () => {
    const pair = seg({
      bookingId: 'pair',
      from: '2026-11-10',
      to: '2026-11-12',
      totalSell: 3_000_000,
    });
    const own = seg({
      bookingId: 'own',
      from: '2026-11-20',
      to: '2026-11-21',
      totalSell: 1_000_000,
    });
    const rows = [row('a', [pair, own]), row('b', [pair]), row('c', [])];
    const nights = visibleNights('month', '2026-11-01');
    expect(rangeStats([rows[0] as CalendarRowData], nights, rows).revenue).toBe(2_500_000);
    expect(rangeStats([rows[1] as CalendarRowData], nights, rows).revenue).toBe(1_500_000);
    expect(rangeStats(rows, nights, rows).revenue).toBe(4_000_000);
  });

  it('reads the next check-ins and check-outs from the window, skipping clipped stays', () => {
    const window = { from: '2026-10-31', to: '2027-02-01' };
    const shown = visibleNights('quarter', '2026-11-01');
    const rows = [
      row('a', [
        // Clipped at the window's first night: an earlier check-in, but a real check-out.
        seg({ bookingId: 'b0', code: 'BK-0', from: '2026-10-31', to: '2026-11-03' }),
        seg({ bookingId: 'b1', code: 'BK-1', from: '2026-11-05', to: '2026-11-07' }),
        seg({
          bookingId: 'blk',
          code: 'BK-B',
          kind: 'block',
          from: '2026-11-08',
          to: '2026-11-09',
        }),
        // Ends on the window's last night: it may go on, so no check-out.
        seg({ bookingId: 'b2', code: 'BK-2', from: '2027-01-30', to: '2027-02-01' }),
      ]),
    ];
    const { checkIns, checkOuts } = stayEvents(rows, shown, '2026-11-02', window);
    expect(checkIns.map((e) => [e.code, e.night])).toEqual([
      ['BK-1', '2026-11-05'],
      ['BK-2', '2027-01-30'],
    ]);
    expect(checkOuts.map((e) => [e.code, e.night])).toEqual([
      ['BK-0', '2026-11-03'],
      ['BK-1', '2026-11-07'],
    ]);
  });

  it('gives each month its own occupancy', () => {
    const rows = [row('a', [seg({ from: '2026-11-29', to: '2026-12-04' })])];
    expect(monthOccupancy(rows, ['2026-11-01', '2026-12-01'])).toEqual([7, 10]);
  });

  it('describes days of one row, or free rooms of the whole place', () => {
    const nights = ['2026-11-06', '2026-11-07', '2026-11-08'];
    const property = {
      id: 'p',
      code: 'H1',
      name: 'H1',
      area: '',
      sellMode: 'rooms',
      standardAdults: 2,
      standardChildren: 0,
      wholePrices: nights.map((night) => ({ night, sell: 1_000, label: 'Tết' })),
      rows: [row('a', [seg({})]), row('b', [])],
      internalNote: '',
      notes: [],
    } satisfies CalendarDto['properties'][number];
    const summary = dayInfos(property, property.rows, true, nights);
    expect(summary.get('2026-11-06')).toMatchObject({
      free: 1,
      total: 2,
      sell: 1_000,
      label: 'Tết',
      segment: null,
    });
    const single = dayInfos(property, [property.rows[0] as CalendarRowData], false, nights);
    expect(single.get('2026-11-06')?.segment?.code).toBe('BK-0001');
    expect(single.get('2026-11-08')).toMatchObject({ free: 1, segment: null, sell: null });
  });

  it('drops defaults from the search', () => {
    expect(compactSearch({ view: 'month', from: '', unit: undefined })).toEqual({});
    expect(compactSearch({ view: 'year', from: '2026-11-01' })).toEqual({
      view: 'year',
      from: '2026-11-01',
    });
  });
});
