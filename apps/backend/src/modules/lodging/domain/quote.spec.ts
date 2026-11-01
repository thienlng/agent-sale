import { describe, expect, it } from 'vitest';

import { override, weekday } from '../__tests__/factories/rate-rules.js';
import { LodgingError } from './lodging.errors.js';
import { quoteStay, resolveUnits, type QuoteProperty, type QuoteUnit } from './quote.js';

const villa: QuoteProperty = {
  sellMode: 'whole',
  standardAdults: 24,
  standardChildren: 8,
  maxGuests: null,
  childFreeBelow: 6,
  childAdultFrom: 12,
  surcharges: { extraAdult: null, extraChild: null },
};
const villaUnits: QuoteUnit[] = [
  { id: 'w', kind: 'whole', capacityAdults: 24, capacityChildren: 8, active: true },
];
const a17Rates = [
  weekday(null, [1, 2, 3, 4], 12_000_000),
  weekday(null, [5, 7], 13_000_000),
  weekday(null, [6], 14_000_000),
];
const whole = { whole: true, unitIds: [] as string[] };

const homestay: QuoteProperty = {
  ...villa,
  sellMode: 'rooms',
  standardAdults: 4,
  standardChildren: 1,
};
const rooms: QuoteUnit[] = [
  { id: 'p1', kind: 'room', capacityAdults: 2, capacityChildren: 1, active: true },
  { id: 'p2', kind: 'room', capacityAdults: 2, capacityChildren: 0, active: true },
  { id: 'p3', kind: 'room', capacityAdults: 2, capacityChildren: 0, active: false },
];
const roomRates = [
  weekday('p1', [1, 2, 3, 4, 5, 6, 7], 1_200_000),
  weekday('p2', [1, 2, 3, 4, 5, 6, 7], 1_000_000),
];

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof LodgingError) return e.code;
    throw e;
  }
  return undefined;
}

describe('resolveUnits', () => {
  it('takes the whole unit of a whole property', () => {
    expect(resolveUnits(villa, villaUnits, whole)).toEqual(['w']);
  });

  it('takes every active room when renting a rooms property whole', () => {
    expect(resolveUnits(homestay, rooms, whole)).toEqual(['p1', 'p2']);
  });

  it('takes the selected active rooms', () => {
    expect(resolveUnits(homestay, rooms, { whole: false, unitIds: ['p2'] })).toEqual(['p2']);
  });

  it('rejects empty, unknown or inactive selections and rooms of a whole property', () => {
    expect(code(() => resolveUnits(homestay, rooms, { whole: false, unitIds: [] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(() => resolveUnits(homestay, rooms, { whole: false, unitIds: ['nope'] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(() => resolveUnits(homestay, rooms, { whole: false, unitIds: ['p3'] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(() => resolveUnits(villa, villaUnits, { whole: false, unitIds: ['w'] }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('quoteStay', () => {
  it('quotes A17 Friday to Sunday by weekday', () => {
    const q = quoteStay(villa, villaUnits, a17Rates, {
      ...whole,
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      adults: 20,
      childAges: [],
    });
    expect(q.nights).toEqual([
      { date: '2026-11-06', weekday: 5, label: '', sell: 13_000_000, cost: 13_000_000 },
      { date: '2026-11-07', weekday: 6, label: '', sell: 14_000_000, cost: 14_000_000 },
    ]);
    expect(q.totalSell).toBe(27_000_000);
    expect(q.totalCost).toBe(27_000_000);
    expect(q.surcharges).toEqual([]);
    expect(q.warnings).toEqual([]);
  });

  it('lets an override win and warns when it needs more nights', () => {
    const rules = [...a17Rates, override(null, '2027-02-05', '2027-02-08', 20_000_000, 'Tết', 2)];
    const q = quoteStay(villa, villaUnits, rules, {
      ...whole,
      checkIn: '2027-02-06',
      checkOut: '2027-02-07',
      adults: 10,
      childAges: [],
    });
    expect(q.nights).toEqual([
      { date: '2027-02-06', weekday: 6, label: 'Tết', sell: 20_000_000, cost: 20_000_000 },
    ]);
    expect(q.totalSell).toBe(20_000_000);
    expect(q.warnings).toContain('min_nights');
  });

  it('charges extra adults and counts older children as adults', () => {
    const p: QuoteProperty = {
      ...villa,
      surcharges: {
        extraAdult: { sell: 300_000, cost: 200_000 },
        extraChild: { sell: 150_000, cost: 100_000 },
      },
    };
    const q = quoteStay(p, villaUnits, a17Rates, {
      ...whole,
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      adults: 26,
      childAges: [3, 7, 13],
    });
    expect(q.surcharges).toEqual([
      { kind: 'extra_adult', persons: 3, nights: 2, sell: 1_800_000, cost: 1_200_000 },
    ]);
    expect(q.totalSell).toBe(27_000_000 + 1_800_000);
    expect(q.totalCost).toBe(27_000_000 + 1_200_000);
    expect(q.warnings).toEqual([]);
  });

  it('charges only the child band above the standard and flags extra small children', () => {
    const p: QuoteProperty = {
      ...villa,
      standardChildren: 1,
      surcharges: { extraAdult: null, extraChild: { sell: 150_000, cost: 100_000 } },
    };
    // small: 2, 3, 4 (3); child: 8 (1); standard children 1 → 3 extra, only 1 chargeable
    const q = quoteStay(p, villaUnits, a17Rates, {
      ...whole,
      checkIn: '2026-11-09',
      checkOut: '2026-11-10',
      adults: 2,
      childAges: [2, 3, 4, 8],
    });
    expect(q.surcharges).toEqual([
      { kind: 'extra_child', persons: 1, nights: 1, sell: 150_000, cost: 100_000 },
    ]);
    expect(q.warnings).toContain('over_standard');
  });

  it('warns over standard when a surcharge is not configured', () => {
    const q = quoteStay(villa, villaUnits, a17Rates, {
      ...whole,
      checkIn: '2026-11-09',
      checkOut: '2026-11-10',
      adults: 25,
      childAges: [],
    });
    expect(q.surcharges).toEqual([]);
    expect(q.warnings).toEqual(['over_standard']);
    expect(q.totalSell).toBe(12_000_000);
  });

  it('warns above the hard maximum', () => {
    const q = quoteStay({ ...villa, maxGuests: 30 }, villaUnits, a17Rates, {
      ...whole,
      checkIn: '2026-11-09',
      checkOut: '2026-11-10',
      adults: 24,
      childAges: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(q.warnings).toContain('over_max');
  });

  it('sums selected rooms of a rooms property', () => {
    const q = quoteStay(homestay, rooms, roomRates, {
      whole: false,
      unitIds: ['p1', 'p2'],
      checkIn: '2026-11-09',
      checkOut: '2026-11-10',
      adults: 4,
      childAges: [],
    });
    expect(q.totalSell).toBe(2_200_000);
    expect(q.warnings).toEqual([]);
  });

  it('uses the rooms capacity as the standard of a room selection', () => {
    const q = quoteStay(homestay, rooms, roomRates, {
      whole: false,
      unitIds: ['p2'],
      checkIn: '2026-11-09',
      checkOut: '2026-11-10',
      adults: 3,
      childAges: [],
    });
    expect(q.warnings).toEqual(['over_standard']);
  });

  it('sums every active room for a whole rental without whole rates', () => {
    const q = quoteStay(homestay, rooms, roomRates, {
      ...whole,
      checkIn: '2026-11-09',
      checkOut: '2026-11-10',
      adults: 4,
      childAges: [],
    });
    expect(q.totalSell).toBe(2_200_000);
  });

  it('prefers whole-property rates for a whole rental of a rooms property', () => {
    const q = quoteStay(
      homestay,
      rooms,
      [...roomRates, weekday(null, [1, 2, 3, 4, 5, 6, 7], 2_000_000)],
      {
        ...whole,
        checkIn: '2026-11-09',
        checkOut: '2026-11-10',
        adults: 4,
        childAges: [],
      },
    );
    expect(q.totalSell).toBe(2_000_000);
  });

  it('uses the first override label when summing rooms', () => {
    const q = quoteStay(
      homestay,
      rooms,
      [...roomRates, override('p2', '2026-12-31', '2026-12-31', 1_500_000, 'NYE')],
      {
        whole: false,
        unitIds: ['p1', 'p2'],
        checkIn: '2026-12-31',
        checkOut: '2027-01-01',
        adults: 4,
        childAges: [],
      },
    );
    expect(q.nights[0]).toMatchObject({ label: 'NYE', sell: 2_700_000 });
  });

  it('drops totals when a room has no rate', () => {
    const q = quoteStay(homestay, rooms, [roomRates[0]!], {
      whole: false,
      unitIds: ['p1', 'p2'],
      checkIn: '2026-11-09',
      checkOut: '2026-11-11',
      adults: 4,
      childAges: [],
    });
    expect(q.warnings).toEqual(['missing_rate']);
    expect(q.totalSell).toBeNull();
    expect(q.totalCost).toBeNull();
    expect(q.nights).toEqual([
      { date: '2026-11-09', weekday: 1, label: '', sell: 0, cost: 0 },
      { date: '2026-11-10', weekday: 2, label: '', sell: 0, cost: 0 },
    ]);
  });
});
