import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { auraPackages, auraRates, pkg } from '../__tests__/factories/packages.js';
import { forPackage, weekday } from '../__tests__/factories/rate-rules.js';
import { unitDetails } from '../__tests__/factories/units.js';
import type { RateRule } from '../domain/rates.js';
import { CalendarService } from './calendar.service.js';
import type { LodgingAccess } from './lodging-access.js';
import type {
  BookingRecord,
  LodgingStore,
  PackageRecord,
  PropertyRecord,
  UnitRecord,
} from './ports/lodging-store.js';

const ws = workspaceId('01890000-0000-7000-8000-000000000001');
const VILLA = '01890000-0000-7000-8000-0000000000a1';
const HOMESTAY = '01890000-0000-7000-8000-0000000000b1';
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function property(id: string, code: string, sellMode: 'whole' | 'rooms'): PropertyRecord {
  return {
    id,
    code,
    name: code,
    area: '',
    address: '',
    description: '',
    sellMode,
    status: 'active',
    standardAdults: sellMode === 'whole' ? 20 : 4,
    standardChildren: 0,
    maxGuests: null,
    childFreeBelow: 6,
    childAdultFrom: 12,
    amenities: [],
    layout: [],
    policies: {
      checkInTime: '',
      checkOutTime: '',
      deposit: '',
      cancellation: '',
      houseRules: '',
      other: '',
    },
    gallery: [],
    galleryCover: '',
    internalNote: '',
    surcharges: { extraAdult: null, extraChild: null },
    sortOrder: 0,
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

const unit = (
  id: string,
  propertyId: string,
  kind: 'whole' | 'room',
  capacityAdults: number,
  sortOrder = 0,
): UnitRecord => ({
  ...unitDetails(),
  id,
  propertyId,
  kind,
  name: id.slice(-2),
  beds: '',
  capacityAdults,
  capacityChildren: 0,
  active: true,
  sortOrder,
});

const villa = property(VILLA, 'A17', 'whole');
const homestay = property(HOMESTAY, 'HS1', 'rooms');
const WHOLE = `${VILLA.slice(0, -2)}ff`;
const P1 = `${HOMESTAY.slice(0, -2)}01`;
const P2 = `${HOMESTAY.slice(0, -2)}02`;
const units = [
  unit(WHOLE, VILLA, 'whole', 20),
  unit(P1, HOMESTAY, 'room', 2, 0),
  unit(P2, HOMESTAY, 'room', 2, 1),
];
const rates = new Map<string, RateRule[]>([
  [VILLA, [weekday(null, ALL_DAYS, 9_000_000)]],
  [HOMESTAY, [weekday(P1, ALL_DAYS, 1_000_000), weekday(P2, ALL_DAYS, 1_200_000)]],
]);

/** An in-memory store with the reads the calendar and availability use; records rate reads. */
function service(
  opts: {
    takenUnits?: string[];
    rates?: Map<string, RateRule[]>;
    packages?: PackageRecord[];
    bookings?: BookingRecord[];
  } = {},
) {
  const rateReads: string[][] = [];
  const tx = {
    expireOverdueHolds: async () => [],
    properties: async (f: { ids?: string[]; activeOnly?: boolean } = {}) =>
      [villa, homestay].filter((p) => !f.ids || f.ids.includes(p.id)),
    property: async (id: string) => [villa, homestay].find((p) => p.id === id) ?? null,
    units: async (ids: string[]) => units.filter((u) => ids.includes(u.propertyId)),
    rates: async (ids: string[]) => ids.flatMap((id) => (opts.rates ?? rates).get(id) ?? []),
    bookingsInRange: async () => opts.bookings ?? [],
    packages: async (ids: string[]) =>
      (opts.packages ?? []).filter((pk) => ids.includes(pk.propertyId)),
    nightNotes: async () => [],
    takenNights: async (unitIds: string[]) =>
      (opts.takenUnits ?? [])
        .filter((id) => unitIds.includes(id))
        .map((unitId) => ({
          unitId,
          night: '2026-12-01',
          bookingId: '01890000-0000-7000-8000-0000000000c1',
          code: 'BK-0001',
        })),
    ratesByProperty: async (ids: string[]) => {
      rateReads.push(ids);
      return new Map(ids.map((id) => [id, (opts.rates ?? rates).get(id) ?? []]));
    },
  };
  const store = { run: (_ws, fn) => fn(tx as never) } as LodgingStore;
  const access = { assertHotel: () => Promise.resolve() } as unknown as LodgingAccess;
  return { calendar: new CalendarService(store, access), rateReads };
}

const request = (adults: number) => ({
  checkIn: '2026-12-01',
  checkOut: '2026-12-03',
  party: { adults, childAges: [] },
});

describe('CalendarService', () => {
  it('reads the rates of every property in one query for the calendar', async () => {
    const { calendar, rateReads } = service();
    const cal = await calendar.calendar(ws, { from: '2026-12-01', to: '2026-12-03' });
    expect(cal.properties.map((p) => p.code)).toEqual(['A17', 'HS1']);
    expect(cal.properties[0]?.wholePrices.map((n) => n.sell)).toEqual([9_000_000, 9_000_000]);
    expect(cal.properties[1]?.rows.map((r) => r.prices[0]?.sell)).toEqual([1_000_000, 1_200_000]);
    expect(rateReads).toEqual([[VILLA, HOMESTAY]]);
  });

  describe('window length', () => {
    const night = (offset: number) => {
      const d = new Date(Date.UTC(2026, 11, 1) + offset * 86_400_000);
      return d.toISOString().slice(0, 10);
    };

    it('serves up to 62 nights for several properties and refuses 63', async () => {
      const { calendar } = service();
      const ok = await calendar.calendar(ws, { from: night(0), to: night(62) });
      expect(ok.properties[0]?.wholePrices).toHaveLength(62);
      await expect(calendar.calendar(ws, { from: night(0), to: night(63) })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(
        calendar.calendar(ws, {
          from: night(0),
          to: night(63),
          propertyIds: `${VILLA},${HOMESTAY}`,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('serves up to 371 nights for exactly one property and refuses 372', async () => {
      const { calendar } = service();
      const year = await calendar.calendar(ws, {
        from: night(0),
        to: night(371),
        propertyIds: HOMESTAY,
      });
      expect(year.properties.map((p) => p.code)).toEqual(['HS1']);
      expect(year.properties[0]?.rows[0]?.prices).toHaveLength(371);
      await expect(
        calendar.calendar(ws, { from: night(0), to: night(372), propertyIds: HOMESTAY }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses an empty or reversed window', async () => {
      const { calendar } = service();
      await expect(
        calendar.calendar(ws, { from: night(1), to: night(1), propertyIds: VILLA }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  it('reads the rates of every property in one query for availability', async () => {
    const { calendar, rateReads } = service();
    await calendar.availability(ws, request(2));
    expect(rateReads).toEqual([[VILLA, HOMESTAY]]);
  });

  it('drops the rooms option when it takes every room of a free rooms property', async () => {
    const { calendar } = service();
    const r = await calendar.availability(ws, { ...request(4), propertyIds: [HOMESTAY] });
    expect(r.options.map((o) => [o.whole, o.unitIds])).toEqual([[true, [P1, P2]]]);
  });

  it('keeps the rooms option when it takes only some rooms, or when the whole is not free', async () => {
    const { calendar } = service();
    const couple = await calendar.availability(ws, { ...request(2), propertyIds: [HOMESTAY] });
    expect(couple.options.map((o) => [o.whole, o.unitIds])).toEqual([
      [false, [P1]],
      [true, [P1, P2]],
    ]);
    const partial = await service({ takenUnits: [P1] }).calendar.availability(ws, {
      ...request(4),
      propertyIds: [HOMESTAY],
    });
    expect(partial.options.map((o) => [o.whole, o.unitIds])).toEqual([[false, [P2]]]);
  });
});

describe('CalendarService with bedroom packages (T-193)', () => {
  // "Aura Villa 6PN" on the villa: 6PN 10/12/18/12 M, 5PN 9/11/16/11 M, 4PN 8/10/–/10 M.
  const aura = (): PackageRecord[] => auraPackages.map((pk) => ({ ...pk, propertyId: VILLA }));
  const withAura = (extra: Parameters<typeof service>[0] = {}) =>
    service({ rates: new Map([[VILLA, auraRates()]]), packages: aura(), ...extra });
  // 2026-12-04 is a Friday, 2026-12-05 a Saturday.
  const weekend = (adults: number) => ({
    checkIn: '2026-12-04',
    checkOut: '2026-12-06',
    party: { adults, childAges: [] },
    propertyIds: [VILLA],
  });

  it('shows the full package price on the calendar and the package names on bars', async () => {
    const stay = {
      id: 'b1',
      code: 'BK-0001',
      propertyId: VILLA,
      kind: 'stay',
      whole: true,
      unitIds: [WHOLE],
      unitPackages: { [WHOLE]: 'pk5' },
      status: 'confirmed',
      checkIn: '2026-12-04',
      checkOut: '2026-12-06',
      adults: 9,
      childAges: [],
      tags: [],
    } as unknown as BookingRecord;
    const cal = await withAura({ bookings: [stay] }).calendar.calendar(ws, {
      from: '2026-12-04',
      to: '2026-12-06',
      propertyIds: VILLA,
    });
    const villaCal = cal.properties[0];
    expect(villaCal?.wholePrices.map((n) => n.sell)).toEqual([12_000_000, 18_000_000]);
    expect(villaCal?.rows[0]?.prices.map((n) => n.sell)).toEqual([12_000_000, 18_000_000]);
    expect(villaCal?.rows[0]?.segments[0]?.packageNames).toEqual(['5PN']);
  });

  it('auto-picks a package per option and lists the others with their totals', async () => {
    const r = await withAura().calendar.availability(ws, weekend(6));
    const option = r.options[0];
    // 4PN is not sold on Saturday, so 6 guests get 5PN (11 M + 16 M).
    expect(option?.packages).toEqual([{ target: null, packageId: 'pk5', name: '5PN' }]);
    expect(option?.quote.totalSell).toBe(27_000_000);
    expect(option?.alternatives).toEqual([
      { packageId: 'pk4', name: '4PN', bedrooms: 4, totalSell: null, fits: true },
      { packageId: 'pk6', name: '6PN', bedrooms: 6, totalSell: 30_000_000, fits: true },
    ]);
  });

  it('offers no alternatives when the option prices two targets, one with packages', async () => {
    const roomRates = new Map([
      [
        HOMESTAY,
        [
          forPackage('p1-2', weekday(P1, ALL_DAYS, 1_500_000)),
          forPackage('p1-1', weekday(P1, ALL_DAYS, 1_000_000)),
          weekday(P2, ALL_DAYS, 1_200_000),
        ],
      ],
    ]);
    const packages = [pkg('p1-2', P1, 2), pkg('p1-1', P1, 1)].map((pk) => ({
      ...pk,
      propertyId: HOMESTAY,
    }));
    const r = await service({ rates: roomRates, packages }).calendar.availability(ws, {
      ...request(4),
      propertyIds: [HOMESTAY],
    });
    expect(r.options.map((o) => [o.unitIds, o.packages, o.alternatives])).toEqual([
      [[P1, P2], [{ target: P1, packageId: 'p1-2', name: '2PN' }], []],
    ]);
  });

  it('has no alternatives without packages', async () => {
    const r = await service().calendar.availability(ws, { ...request(2), propertyIds: [VILLA] });
    expect(r.options[0]).toMatchObject({ packages: [], alternatives: [] });
  });

  it('does not report the edited booking as a conflict of its own preview (VL-A3)', async () => {
    const stay = {
      propertyId: VILLA,
      whole: true,
      unitIds: [],
      packageIds: [],
      checkIn: '2026-12-01',
      checkOut: '2026-12-03',
      party: { adults: 4, childAges: [] },
    };
    const { calendar } = service({ takenUnits: [WHOLE] });
    expect((await calendar.quote(ws, stay)).takenBy).toEqual(['BK-0001']);
    const own = await calendar.quote(ws, {
      ...stay,
      excludeBookingId: '01890000-0000-7000-8000-0000000000c1',
    });
    expect(own.takenBy).toEqual([]);
  });

  it('quotes an explicit package', async () => {
    const q = await withAura().calendar.quote(ws, {
      propertyId: VILLA,
      whole: true,
      unitIds: [],
      packageIds: ['pk6'],
      checkIn: '2026-12-04',
      checkOut: '2026-12-06',
      party: { adults: 6, childAges: [] },
    });
    expect(q.totalSell).toBe(30_000_000);
    expect(q.packages).toEqual([{ target: null, packageId: 'pk6', name: '6PN' }]);
  });

  describe('keepPackageIds (a booking edit preview, as the save prices it)', () => {
    const villaStay = (adults: number, checkIn: string, checkOut: string) => ({
      propertyId: VILLA,
      whole: true,
      unitIds: [],
      packageIds: [],
      checkIn,
      checkOut,
      party: { adults, childAges: [] },
    });

    it('keeps the stored package while it still fits', async () => {
      // Mon→Wed, 6 guests: 4PN fits and prices every night.
      const q = await withAura().calendar.quote(ws, {
        ...villaStay(6, '2026-11-30', '2026-12-02'),
        keepPackageIds: ['pk6'],
      });
      expect(q.packages).toEqual([{ target: null, packageId: 'pk6', name: '6PN' }]);
      expect(q.totalSell).toBe(20_000_000);
    });

    it('re-picks when the stored package leaves a night unpriced', async () => {
      // An auto-picked 4PN moved onto a Saturday: the save re-picks 5PN, so does the preview.
      const q = await withAura().calendar.quote(ws, {
        ...villaStay(6, '2026-12-04', '2026-12-06'),
        keepPackageIds: ['pk4'],
      });
      expect(q.packages).toEqual([{ target: null, packageId: 'pk5', name: '5PN' }]);
      expect(q.warnings).not.toContain('package_unavailable');
      expect(q.totalSell).toBe(27_000_000);
    });

    it('re-picks when the party outgrows the stored package', async () => {
      const q = await withAura().calendar.quote(ws, {
        ...villaStay(11, '2026-11-30', '2026-12-02'),
        keepPackageIds: ['pk4'],
      });
      expect(q.packages).toEqual([{ target: null, packageId: 'pk5', name: '5PN' }]);
      expect(q.warnings).not.toContain('over_max');
    });

    it('is ignored when explicit packages are sent', async () => {
      const q = await withAura().calendar.quote(ws, {
        ...villaStay(6, '2026-12-04', '2026-12-06'),
        packageIds: ['pk6'],
        keepPackageIds: ['pk4'],
      });
      expect(q.packages).toEqual([{ target: null, packageId: 'pk6', name: '6PN' }]);
    });
  });
});
