import { describe, expect, it } from 'vitest';

import { auraPackages, auraRates, pkg } from '../__tests__/factories/packages.js';
import { forPackage, override, weekday } from '../__tests__/factories/rate-rules.js';
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

  it('applies a whole-only override on its nights and sums rooms on the others', () => {
    const rules = [...roomRates, override(null, '2026-12-31', '2026-12-31', 5_000_000, 'NYE', 2)];
    const q = quoteStay(homestay, rooms, rules, {
      ...whole,
      checkIn: '2026-12-30',
      checkOut: '2027-01-01',
      adults: 4,
      childAges: [],
    });
    expect(q.nights).toEqual([
      { date: '2026-12-30', weekday: 3, label: '', sell: 2_200_000, cost: 2_200_000 },
      { date: '2026-12-31', weekday: 4, label: 'NYE', sell: 5_000_000, cost: 5_000_000 },
    ]);
    expect(q.totalSell).toBe(7_200_000);
    expect(q.warnings).toEqual([]);
  });

  it('takes min nights from a whole-only override of a rooms property', () => {
    const rules = [...roomRates, override(null, '2026-12-31', '2026-12-31', 5_000_000, 'NYE', 2)];
    const q = quoteStay(homestay, rooms, rules, {
      ...whole,
      checkIn: '2026-12-31',
      checkOut: '2027-01-01',
      adults: 4,
      childAges: [],
    });
    expect(q.nights[0]).toMatchObject({ label: 'NYE', sell: 5_000_000 });
    expect(q.warnings).toEqual(['min_nights']);
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

describe('quoteStay with bedroom packages', () => {
  const aura: QuoteProperty = { ...villa, standardAdults: 12, standardChildren: 0, maxGuests: 16 };
  const auraUnits: QuoteUnit[] = [
    { id: 'w', kind: 'whole', capacityAdults: 12, capacityChildren: 0, active: true },
  ];
  const stay = (checkIn: string, checkOut: string, adults: number, packageIds?: string[]) => ({
    ...whole,
    checkIn,
    checkOut,
    adults,
    childAges: [] as number[],
    ...(packageIds ? { packageIds } : {}),
  });

  it('auto-picks the fewest bedrooms that hold the party and price every night', () => {
    const q = quoteStay(
      aura,
      auraUnits,
      auraRates(),
      stay('2026-11-09', '2026-11-10', 6),
      auraPackages,
    );
    expect(q.packages).toEqual([{ target: null, packageId: 'pk4', name: '4PN' }]);
    expect(q.totalSell).toBe(8_000_000);
    expect(q.warnings).toEqual([]);
  });

  it('skips 4PN on a Saturday stay because it is not sold that night', () => {
    const q = quoteStay(
      aura,
      auraUnits,
      auraRates(),
      stay('2026-11-06', '2026-11-08', 6),
      auraPackages,
    );
    expect(q.packages).toEqual([{ target: null, packageId: 'pk5', name: '5PN' }]);
    expect(q.totalSell).toBe(11_000_000 + 16_000_000);
    expect(q.warnings).toEqual([]);
  });

  it('auto-picks 6PN for 14 guests', () => {
    const q = quoteStay(
      aura,
      auraUnits,
      auraRates(),
      stay('2026-11-07', '2026-11-08', 14),
      auraPackages,
    );
    expect(q.packages).toEqual([{ target: null, packageId: 'pk6', name: '6PN' }]);
    expect(q.totalSell).toBe(18_000_000);
    expect(q.warnings).toEqual(['over_standard']); // 14 > 6PN standard 12, no surcharge set
  });

  it('counts children in the party of the auto-pick', () => {
    const q = quoteStay(
      aura,
      auraUnits,
      auraRates(),
      { ...stay('2026-11-09', '2026-11-10', 8), childAges: [3, 4, 5] },
      auraPackages,
    );
    expect(q.packages[0]?.packageId).toBe('pk5'); // 11 guests > 4PN max 10
  });

  it('falls back to the full package when no package holds the party', () => {
    const q = quoteStay(
      aura,
      auraUnits,
      auraRates(),
      stay('2026-11-09', '2026-11-10', 20),
      auraPackages,
    );
    expect(q.packages[0]?.packageId).toBe('pk6');
    expect(q.warnings).toContain('over_max');
  });

  it('uses the standard party of a package without a maximum for the auto-pick', () => {
    const packages = auraPackages.map((p) => ({ ...p, maxGuests: null }));
    const q = quoteStay(
      aura,
      auraUnits,
      auraRates(),
      stay('2026-11-09', '2026-11-10', 9),
      packages,
    );
    expect(q.packages[0]?.packageId).toBe('pk5'); // 4PN standard 8 < 9
  });

  it('flags an explicit package that is not sold on a night', () => {
    const q = quoteStay(
      aura,
      auraUnits,
      auraRates(),
      stay('2026-11-06', '2026-11-08', 6, ['pk4']),
      auraPackages,
    );
    expect(q.packages).toEqual([{ target: null, packageId: 'pk4', name: '4PN' }]);
    expect(q.nights).toEqual([
      { date: '2026-11-06', weekday: 5, label: '', sell: 10_000_000, cost: 10_000_000 },
      { date: '2026-11-07', weekday: 6, label: '', sell: 0, cost: 0 },
    ]);
    expect(q.warnings).toEqual(['missing_rate', 'package_unavailable']);
    expect(q.totalSell).toBeNull();
    expect(q.totalCost).toBeNull();
  });

  it('honours an explicit package over the auto-pick', () => {
    const q = quoteStay(
      aura,
      auraUnits,
      auraRates(),
      stay('2026-11-09', '2026-11-10', 6, ['pk6']),
      auraPackages,
    );
    expect(q.packages[0]?.packageId).toBe('pk6');
    expect(q.totalSell).toBe(10_000_000);
  });

  it('lets an override of the package win, also on a night it does not sell', () => {
    const rules = [
      ...auraRates(),
      forPackage('pk4', override(null, '2026-11-07', '2026-11-07', 15_000_000, 'Promo')),
    ];
    const q = quoteStay(aura, auraUnits, rules, stay('2026-11-07', '2026-11-08', 6), auraPackages);
    expect(q.packages[0]?.packageId).toBe('pk4');
    expect(q.nights[0]).toMatchObject({ label: 'Promo', sell: 15_000_000 });
  });

  it('refuses an unknown package or a package of another target', () => {
    expect(
      code(() =>
        quoteStay(
          aura,
          auraUnits,
          auraRates(),
          stay('2026-11-09', '2026-11-10', 6, ['x']),
          auraPackages,
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    const roomPackage = [...auraPackages, pkg('r', 'p1', 1)];
    expect(
      code(() =>
        quoteStay(
          aura,
          auraUnits,
          auraRates(),
          stay('2026-11-09', '2026-11-10', 6, ['r']),
          roomPackage,
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('uses the package standard and surcharges above it', () => {
    const p: QuoteProperty = {
      ...aura,
      surcharges: { extraAdult: { sell: 500_000, cost: 300_000 }, extraChild: null },
    };
    const q = quoteStay(
      p,
      auraUnits,
      auraRates(),
      stay('2026-11-09', '2026-11-10', 9, ['pk4']),
      auraPackages,
    );
    expect(q.surcharges).toEqual([
      { kind: 'extra_adult', persons: 1, nights: 1, sell: 500_000, cost: 300_000 },
    ]);
    expect(q.totalSell).toBe(8_500_000);
  });

  it('warns over the maximum of the chosen package', () => {
    const q = quoteStay(
      aura,
      auraUnits,
      auraRates(),
      stay('2026-11-09', '2026-11-10', 11, ['pk4']),
      auraPackages,
    );
    expect(q.warnings).toContain('over_max');
  });

  it('prices room packages and picks the full package when several rooms are chosen', () => {
    const roomPackages = [
      pkg('p1a', 'p1', 1, { maxGuests: 2 }),
      pkg('p1b', 'p1', 2, { maxGuests: 4 }),
    ];
    const rules = [
      forPackage('p1a', weekday('p1', [1, 2, 3, 4, 5, 6, 7], 700_000)),
      forPackage('p1b', weekday('p1', [1, 2, 3, 4, 5, 6, 7], 1_200_000)),
      roomRates[1]!,
    ];
    const one = quoteStay(
      homestay,
      rooms,
      rules,
      {
        whole: false,
        unitIds: ['p1'],
        checkIn: '2026-11-09',
        checkOut: '2026-11-10',
        adults: 2,
        childAges: [],
      },
      roomPackages,
    );
    expect(one.packages).toEqual([{ target: 'p1', packageId: 'p1a', name: '1PN' }]);
    expect(one.totalSell).toBe(700_000);
    const two = quoteStay(
      homestay,
      rooms,
      rules,
      {
        whole: false,
        unitIds: ['p1', 'p2'],
        checkIn: '2026-11-09',
        checkOut: '2026-11-10',
        adults: 2,
        childAges: [],
      },
      roomPackages,
    );
    expect(two.packages).toEqual([{ target: 'p1', packageId: 'p1b', name: '2PN' }]);
    expect(two.totalSell).toBe(2_200_000);
  });

  it('warns over the summed unit maxima when every selected unit has one', () => {
    const capped = rooms.map((u) => ({ ...u, maxGuests: 2 }));
    const q = quoteStay(homestay, capped, roomRates, {
      whole: false,
      unitIds: ['p1', 'p2'],
      checkIn: '2026-11-09',
      checkOut: '2026-11-10',
      adults: 5,
      childAges: [],
    });
    expect(q.warnings).toContain('over_max');
    const partly = capped.map((u) => (u.id === 'p2' ? { ...u, maxGuests: null } : u));
    const r = quoteStay(homestay, partly, roomRates, {
      whole: false,
      unitIds: ['p1', 'p2'],
      checkIn: '2026-11-09',
      checkOut: '2026-11-10',
      adults: 5,
      childAges: [],
    });
    expect(r.warnings).not.toContain('over_max');
  });

  it('lists no packages for a property without packages', () => {
    const q = quoteStay(villa, villaUnits, a17Rates, stay('2026-11-06', '2026-11-08', 20));
    expect(q.packages).toEqual([]);
    expect(q.totalSell).toBe(27_000_000);
  });
});
