import { ProductDto } from '@agent-sales/contracts';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { auraPackages, auraRates } from '../__tests__/factories/packages.js';
import { override, weekday } from '../__tests__/factories/rate-rules.js';
import { unitDetails } from '../__tests__/factories/units.js';
import { LodgingUnavailableError } from '../domain/lodging.errors.js';
import type { RateRule } from '../domain/rates.js';
import { LodgingBotCatalog } from './bot-catalog.js';
import { toBotProduct } from './bot-product.js';
import type { LodgingStore, PropertyRecord, UnitRecord } from './ports/lodging-store.js';

const ws = workspaceId('01890000-0000-7000-8000-000000000001');
const A17_ID = '01890000-0000-7000-8000-0000000000a1';
const R01_ID = '01890000-0000-7000-8000-0000000000b1';
const PAUSED_ID = '01890000-0000-7000-8000-0000000000c1';
const STAMP = '2026-11-01T00:00:00.000Z';
/** Cost prices that must never reach the bot (distinct from every sell price). */
const COSTS = [9_111_111, 9_222_222, 9_333_333, 333_111, 444_222, 555_333];

function property(over: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: A17_ID,
    code: 'A17',
    name: 'SKY VILLA A17 – Villa nguyên căn view sân golf Tam Đảo',
    area: 'Sân Golf Tam Đảo',
    address: 'Tam Đảo, Vĩnh Phúc',
    description: 'Villa 8 phòng ngủ, bể bơi vô cực.',
    sellMode: 'whole',
    status: 'active',
    standardAdults: 24,
    standardChildren: 8,
    maxGuests: null,
    childFreeBelow: 6,
    childAdultFrom: 12,
    amenities: ['Bể bơi vô cực', 'Karaoke'],
    layout: Array.from({ length: 8 }, (_, i) => ({
      name: `Phòng ${i + 1}`,
      beds: i === 7 ? '' : '1 giường 1,8 m',
      note: '',
    })),
    policies: {
      checkInTime: '14:00',
      checkOutTime: '12:00',
      deposit: 'Cọc 50%',
      cancellation: '',
      houseRules: 'Không hát karaoke sau 22h',
      other: 'Có chỗ đỗ ô tô',
    },
    gallery: [
      {
        id: 'pool',
        name: 'Hồ bơi',
        items: [
          { kind: 'image', url: 'https://cdn.example.com/a17/1.jpg', caption: 'Bể bơi' },
          { kind: 'image', url: 'https://cdn.example.com/a17/2.jpg', caption: '' },
          {
            kind: 'video',
            url: `/media/lodging/${ws}/01890000-0000-7000-8000-0000000000e1.mp4`,
            caption: 'Tour',
          },
          { kind: 'link', url: 'https://youtu.be/a17', caption: 'Flycam' },
        ],
      },
      {
        id: 'rooms',
        name: 'Phòng ngủ',
        items: Array.from({ length: 5 }, (_, i) => ({
          kind: 'image' as const,
          url: `https://cdn.example.com/a17/${i + 3}.jpg`,
          caption: `Ảnh ${i + 3}`,
        })),
      },
    ],
    galleryCover: '',
    internalNote: '',
    surcharges: {
      extraAdult: { sell: 300_000, cost: COSTS[3]! },
      extraChild: { sell: 150_000, cost: COSTS[4]! },
    },
    sortOrder: 0,
    version: 3,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...over,
  };
}

const wholeUnit = (pid = A17_ID): UnitRecord => ({
  ...unitDetails(),
  id: `${pid.slice(0, -2)}ff`,
  propertyId: pid,
  kind: 'whole',
  name: 'A17',
  beds: '',
  capacityAdults: 24,
  capacityChildren: 8,
  active: true,
  sortOrder: 0,
});

const a17Rates = (): RateRule[] => [
  weekday(null, [1, 2, 3, 4], 12_000_000, COSTS[0]),
  weekday(null, [5, 7], 13_000_000, COSTS[1]),
  weekday(null, [6], 14_000_000, COSTS[2]),
  override(null, '2026-12-31', '2027-01-01', 20_000_000, 'Tết Dương lịch', 2),
  override(null, '2026-09-01', '2026-09-02', 18_000_000, 'Quốc khánh'),
];

const room = (id: string, name: string, sortOrder: number, active = true): UnitRecord => ({
  ...unitDetails(),
  id,
  propertyId: R01_ID,
  kind: 'room',
  name,
  beds: '1 giường đôi',
  capacityAdults: 2,
  capacityChildren: 1,
  active,
  sortOrder,
});
const P1 = '01890000-0000-7000-8000-0000000000d1';
const P2 = '01890000-0000-7000-8000-0000000000d2';
const P3 = '01890000-0000-7000-8000-0000000000d3';

describe('toBotProduct', () => {
  const today = '2026-11-01';

  it('maps an A17-shaped whole property to a valid accommodation product', () => {
    const dto = toBotProduct(property(), [wholeUnit()], a17Rates(), today);
    expect(dto).not.toBeNull();
    const parsed = ProductDto.parse(dto);
    expect(parsed.id).toBe(A17_ID);
    expect(parsed.code).toBe('A17');
    expect(parsed.name).toBe('A17 – SKY VILLA A17 – Villa nguyên căn view sân golf Tam Đảo');
    expect(parsed.status).toBe('active');
    expect(parsed.category).toBe('Sân Golf Tam Đảo');
    expect(parsed.priceMin).toBe(12_000_000);
    expect(parsed.priceMax).toBe(14_000_000);
    expect(parsed.imageUrls).toHaveLength(5);
    const acc = parsed.accommodation!;
    expect(acc.rentalType).toBe('entire_property');
    expect(acc.code).toBe('A17');
    expect(acc.rateBasis).toBe('night');
    expect(acc.bedrooms).toBe(8);
    expect(acc.roomLayout).toHaveLength(8);
    expect(acc.roomLayout[7]?.beds).toBe('(not provided)');
    expect(acc.childAgeBelow).toBe(6);
    expect(acc.rates.flatMap((r) => r.days).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(acc.rates).toContainEqual({ days: [6], amount: 14_000_000 });
    expect(acc.units).toBeUndefined();
    // Past overrides are dropped; future ones keep their label and price.
    expect(acc.overrides).toEqual([
      {
        dateFrom: '2026-12-31',
        dateTo: '2027-01-01',
        label: 'Tết Dương lịch (min 2 nights)',
        amount: 20_000_000,
        unitName: null,
      },
    ]);
    expect(acc.surcharges).toEqual({
      extraAdult: 300_000,
      extraChild: 150_000,
      childFreeBelow: 6,
      childAdultFrom: 12,
    });
    expect(acc.checkInOut).toBe('14:00 / 12:00');
    expect(acc.depositPolicy).toBe('Cọc 50%');
    expect(acc.cancellationPolicy).toBe('');
    expect(acc.extraGuestPolicy).toBe('');
    expect(acc.holidayPolicy).toBe('');
    expect(acc.notes).toContain('Không hát karaoke sau 22h');
    expect(acc.notes).toContain('Có chỗ đỗ ô tô');
    expect(acc.gallery).toHaveLength(7);
    // An empty caption falls back to the folder name (the image allowlist needs a label).
    expect(acc.gallery[1]?.caption).toBe('Hồ bơi');
  });

  it('never carries a cost price', () => {
    const json = JSON.stringify(toBotProduct(property(), [wholeUnit()], a17Rates(), today));
    for (const cost of COSTS) expect(json).not.toContain(String(cost));
    expect(json).not.toMatch(/"cost"/);
  });

  it('never carries the internal note', () => {
    const secret = 'INTERNAL: owner is difficult, call before 21h';
    const dto = toBotProduct(property({ internalNote: secret }), [wholeUnit()], a17Rates(), today);
    expect(dto).not.toBeNull();
    expect(JSON.stringify(dto)).not.toContain('owner is difficult');
  });

  it('sells a villa with packages at its full package weekday prices (T-193)', () => {
    const acc = toBotProduct(
      property(),
      [wholeUnit()],
      auraRates(),
      today,
      auraPackages,
    )?.accommodation;
    expect(acc?.rates).toEqual([
      { days: [1, 2, 3, 4], amount: 10_000_000 },
      { days: [5], amount: 12_000_000 },
      { days: [6], amount: 18_000_000 },
      { days: [7], amount: 12_000_000 },
    ]);
  });

  it('lists the packages of the whole property with their weekday sell prices (T-193)', () => {
    const acc = toBotProduct(
      property(),
      [wholeUnit()],
      auraRates(),
      today,
      auraPackages,
    )?.accommodation;
    expect(acc?.packages).toEqual([
      {
        name: '4PN',
        bedrooms: 4,
        standardAdults: 8,
        standardChildren: 0,
        maxGuests: 10,
        weekdaySell: [8e6, 8e6, 8e6, 8e6, 10e6, null, 10e6],
      },
      {
        name: '5PN',
        bedrooms: 5,
        standardAdults: 10,
        standardChildren: 0,
        maxGuests: 12,
        weekdaySell: [9e6, 9e6, 9e6, 9e6, 11e6, 16e6, 11e6],
      },
      {
        name: '6PN',
        bedrooms: 6,
        standardAdults: 12,
        standardChildren: 0,
        maxGuests: 16,
        weekdaySell: [10e6, 10e6, 10e6, 10e6, 12e6, 18e6, 12e6],
      },
    ]);
    expect(
      toBotProduct(property(), [wholeUnit()], a17Rates(), today)?.accommodation?.packages,
    ).toBeUndefined();
    // A date-range price of a package names it.
    const tet = {
      ...override(null, '2027-02-05', '2027-02-08', 25_000_000, 'Tết'),
      packageId: 'pk5',
    };
    const dated = toBotProduct(
      property(),
      [wholeUnit()],
      [...auraRates(), tet],
      today,
      auraPackages,
    );
    expect(dated?.accommodation?.overrides?.[0]).toMatchObject({
      amount: 25e6,
      packageName: '5PN',
    });
  });

  it('carries unit details, unit albums and unit packages of a rooms property (T-193)', () => {
    const p = property({ id: R01_ID, code: 'R01', sellMode: 'rooms', layout: [] });
    const hill = {
      ...room(P1, 'Bungalow 1', 0),
      category: 'bungalow' as const,
      view: 'đồi thông',
      areaM2: 45,
      description: 'Bungalow gỗ, ban công nhìn ra đồi',
      amenities: ['Bồn tắm', 'Ban công'],
      maxGuests: 4,
      gallery: [
        {
          id: '01890000-0000-7000-8000-0000000000f1',
          name: 'Bungalow 1',
          items: [
            {
              kind: 'image' as const,
              url: 'https://cdn.example.com/b1/1.jpg',
              caption: ' Ban công ',
            },
          ],
        },
      ],
    };
    const units = [hill, room(P2, 'P2', 1)];
    const packages = [
      { ...auraPackages[0]!, id: 'b2', unitId: P1, name: '2PN', bedrooms: 2, maxGuests: 4 },
      { ...auraPackages[1]!, id: 'b1', unitId: P1, name: '1PN', bedrooms: 1, maxGuests: 2 },
    ];
    const rates = [
      { ...weekday(P1, [1, 2, 3, 4, 5, 6, 7], 2_000_000, 700_001), packageId: 'b2' },
      { ...weekday(P1, [1, 2, 3, 4, 5], 1_200_000, 700_002), packageId: 'b1' },
      weekday(P2, [1, 2, 3, 4, 5, 6, 7], 900_000, 700_003),
    ];
    const dto = ProductDto.parse(toBotProduct(p, units, rates, today, packages));
    const [b1, p2] = dto.accommodation!.units!;
    expect(b1).toMatchObject({
      name: 'Bungalow 1',
      category: 'bungalow',
      view: 'đồi thông',
      areaM2: 45,
      description: 'Bungalow gỗ, ban công nhìn ra đồi',
      amenities: ['Bồn tắm', 'Ban công'],
      maxGuests: 4,
      weekdayRates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 2_000_000 }],
    });
    expect(b1?.albums).toEqual([
      {
        id: '01890000-0000-7000-8000-0000000000f1',
        name: 'Bungalow 1',
        items: [{ kind: 'image', url: 'https://cdn.example.com/b1/1.jpg', caption: 'Ban công' }],
      },
    ]);
    expect(b1?.packages?.map((k) => [k.name, k.weekdaySell])).toEqual([
      ['1PN', [1.2e6, 1.2e6, 1.2e6, 1.2e6, 1.2e6, null, null]],
      ['2PN', [2e6, 2e6, 2e6, 2e6, 2e6, 2e6, 2e6]],
    ]);
    expect(p2?.albums).toBeUndefined();
    expect(p2?.packages).toBeUndefined();
    expect(p2).toMatchObject({ category: 'room', view: '', areaM2: null, maxGuests: null });
    expect(dto.accommodation?.packages).toBeUndefined();
    expect(JSON.stringify(dto)).not.toMatch(/70000[123]/);
  });

  it('skips a property whose weekdays are not all priced', () => {
    expect(toBotProduct(property(), [wholeUnit()], [], today)).toBeNull();
    const partial = [weekday(null, [1, 2, 3], 1_000_000)];
    expect(toBotProduct(property(), [wholeUnit()], partial, today)).toBeNull();
  });

  it('maps a rooms property with its active rooms and the whole place at the sum of the rooms', () => {
    const p = property({
      id: R01_ID,
      code: 'R01',
      name: 'Homestay Mây',
      sellMode: 'rooms',
      layout: [],
    });
    const units = [room(P1, 'P1', 0), room(P2, 'P2', 1), room(P3, 'P3', 2, false)];
    const rates = [
      weekday(P1, [1, 2, 3, 4, 5, 6, 7], 1_200_000, 700_001),
      weekday(P2, [1, 2, 3, 4, 5], 900_000, 700_002),
      weekday(P2, [6, 7], 1_000_000, 700_003),
      weekday(P3, [1, 2, 3, 4, 5, 6, 7], 500_000),
      override(P2, '2026-12-24', '2026-12-25', 1_500_000, 'Noel'),
    ];
    const dto = ProductDto.parse(toBotProduct(p, units, rates, today));
    const acc = dto.accommodation!;
    expect(acc.rentalType).toBe('rooms');
    expect(acc.bedrooms).toBe(2);
    expect(acc.roomLayout.map((r) => r.name)).toEqual(['P1', 'P2']);
    expect(acc.units?.map((u) => u.name)).toEqual(['P1', 'P2']);
    expect(acc.units?.[1]?.weekdayRates).toEqual([
      { days: [1, 2, 3, 4, 5], amount: 900_000 },
      { days: [6, 7], amount: 1_000_000 },
    ]);
    // No whole-property rule: the whole place costs P1 + P2 per night (the inactive P3 is out).
    expect(acc.rates).toEqual([
      { days: [1, 2, 3, 4, 5], amount: 2_100_000 },
      { days: [6, 7], amount: 2_200_000 },
    ]);
    expect(acc.overrides).toEqual([
      {
        dateFrom: '2026-12-24',
        dateTo: '2026-12-25',
        label: 'Noel',
        amount: 1_500_000,
        unitName: 'P2',
      },
    ]);
    expect(dto.priceMin).toBe(900_000);
    expect(JSON.stringify(dto)).not.toMatch(/70000[123]/);
  });

  it('hides a rooms property without whole rules when an active room lacks a weekday price', () => {
    const p = property({ id: R01_ID, code: 'R01', sellMode: 'rooms', layout: [] });
    const units = [room(P1, 'P1', 0), room(P2, 'P2', 1)];
    const rates = [
      weekday(P1, [1, 2, 3, 4, 5, 6, 7], 1_200_000),
      weekday(P2, [1, 2, 3, 4, 5], 900_000),
    ];
    expect(toBotProduct(p, units, rates, today)).toBeNull();
    expect(toBotProduct(p, [], [], today)).toBeNull();
  });

  it('keeps the minimum stay of a date-range price in its label', () => {
    const rates = [
      ...a17Rates().filter((r) => r.kind === 'weekday'),
      override(null, '2026-12-31', '2027-01-01', 20_000_000, 'Tết Dương lịch', 2),
      override(null, '2027-02-10', '2027-02-12', 25_000_000, '', 3),
      override(null, '2027-04-30', '2027-05-01', 18_000_000, 'Lễ', 1),
    ];
    const acc = toBotProduct(property(), [wholeUnit()], rates, today)!.accommodation!;
    expect(acc.overrides?.map((o) => o.label)).toEqual([
      'Tết Dương lịch (min 2 nights)',
      '(min 3 nights)',
      'Lễ',
    ]);
  });

  it('prefers whole-property weekday rates of a rooms property', () => {
    const p = property({ id: R01_ID, code: 'R01', sellMode: 'rooms', layout: [] });
    const units = [room(P1, 'P1', 0)];
    const rates = [
      weekday(P1, [1, 2, 3, 4, 5, 6, 7], 1_200_000),
      weekday(null, [1, 2, 3, 4, 5, 6, 7], 2_000_000),
    ];
    const acc = ProductDto.parse(toBotProduct(p, units, rates, today)).accommodation!;
    expect(acc.rates).toEqual([{ days: [1, 2, 3, 4, 5, 6, 7], amount: 2_000_000 }]);
  });

  it('carries the folders as albums, in order, with their videos and links', () => {
    const acc = ProductDto.parse(
      toBotProduct(property(), [wholeUnit()], a17Rates(), today),
    ).accommodation!;
    expect(acc.albums?.map((a) => [a.name, a.items.map((i) => i.kind)])).toEqual([
      ['Hồ bơi', ['image', 'image', 'video', 'link']],
      ['Phòng ngủ', ['image', 'image', 'image', 'image', 'image']],
    ]);
    expect(acc.gallery.map((g) => g.url)).not.toContain('https://youtu.be/a17');
  });

  it('puts the chosen cover first in imageUrls, once', () => {
    const cover = 'https://cdn.example.com/a17/5.jpg';
    const dto = toBotProduct(property({ galleryCover: cover }), [wholeUnit()], a17Rates(), today);
    expect(dto?.imageUrls[0]).toBe(cover);
    expect(dto?.imageUrls.filter((u) => u === cover)).toHaveLength(1);
    expect(dto?.imageUrls).toHaveLength(5);
  });

  it('leaves albums out of a property without folders', () => {
    const acc = toBotProduct(
      property({ gallery: [] }),
      [wholeUnit()],
      a17Rates(),
      today,
    )?.accommodation;
    expect(acc?.albums).toBeUndefined();
    expect(acc?.gallery).toEqual([]);
  });
});

/** An in-memory store with the reads the bot catalog uses. */
function storeWith(opts: {
  properties: PropertyRecord[];
  units: UnitRecord[];
  rates: Map<string, RateRule[]>;
  botIds?: string[] | null;
  /** Records the property ids of every rate read. */
  rateReads?: string[][];
}): LodgingStore {
  const tx = {
    botPropertyIds: async () => opts.botIds ?? null,
    properties: async (f: { ids?: string[]; activeOnly?: boolean } = {}) =>
      opts.properties.filter(
        (p) => (!f.ids || f.ids.includes(p.id)) && (!f.activeOnly || p.status === 'active'),
      ),
    units: async (ids: string[]) => opts.units.filter((u) => ids.includes(u.propertyId)),
    packages: async () => [],
    ratesByProperty: async (ids: string[]) => {
      opts.rateReads?.push(ids);
      return new Map(ids.map((id) => [id, opts.rates.get(id) ?? []]));
    },
  };
  return { run: (_ws, fn) => fn(tx as never) } as LodgingStore;
}

describe('LodgingBotCatalog', () => {
  const villa = property();
  const paused = property({ id: PAUSED_ID, code: 'B02', name: 'Villa B02', status: 'paused' });
  const other = property({
    id: '01890000-0000-7000-8000-0000000000e1',
    code: 'C03',
    name: 'Biệt thự hồ',
    area: 'Đại Lải',
    amenities: ['BBQ'],
  });
  const rates = new Map<string, RateRule[]>([
    [villa.id, a17Rates()],
    [paused.id, a17Rates()],
    [other.id, [weekday(null, [1, 2, 3, 4, 5, 6, 7], 5_000_000)]],
  ]);
  const units = [wholeUnit(villa.id), wholeUnit(paused.id), wholeUnit(other.id)];
  const scope = { botId: 'bot-1', catalogMode: 'selected' as const };
  const catalog = (botIds: string[] | null = null) =>
    new LodgingBotCatalog(storeWith({ properties: [villa, paused, other], units, rates, botIds }));

  it('without a selection offers every active property', async () => {
    const rows = await catalog().searchBotCatalog(ws, scope, { limit: 300 });
    expect(rows.map((r) => r.code)).toEqual(['A17', 'C03']);
    expect(await catalog().countBotCatalog(ws, scope)).toBe(2);
  });

  it('reads the rates of every offered property in one query', async () => {
    const rateReads: string[][] = [];
    const c = new LodgingBotCatalog(
      storeWith({ properties: [villa, paused, other], units, rates, rateReads }),
    );
    expect(await c.countBotCatalog(ws, scope)).toBe(2);
    expect(rateReads).toEqual([[villa.id, other.id]]);
  });

  it('respects the bot selection (and still hides paused properties)', async () => {
    const c = catalog([other.id, paused.id]);
    expect((await c.searchBotCatalog(ws, scope, { limit: 300 })).map((r) => r.code)).toEqual([
      'C03',
    ]);
    expect(await c.countBotCatalog(ws, scope)).toBe(1);
    expect(await c.getBotProductsByIds(ws, scope, [villa.id, other.id])).toHaveLength(1);
  });

  it('finds A17 by code and by accent-free area words', async () => {
    for (const query of ['a17', 'san golf', 'A17 Tam Đảo']) {
      const rows = await catalog().searchBotCatalog(ws, scope, { query, limit: 8 });
      expect(rows[0]?.code, query).toBe('A17');
    }
    const bbq = await catalog().searchBotCatalog(ws, scope, { query: 'bbq', limit: 8 });
    expect(bbq.map((r) => r.code)).toEqual(['C03']);
    expect(await catalog().searchBotCatalog(ws, scope, { query: 'xyz', limit: 8 })).toEqual([]);
  });

  it('filters by the lowest nightly price and caps the rows', async () => {
    const cheap = await catalog().searchBotCatalog(ws, scope, {
      maxPriceVnd: 6_000_000,
      limit: 8,
    });
    expect(cheap.map((r) => r.code)).toEqual(['C03']);
    expect(await catalog().searchBotCatalog(ws, scope, { limit: 1 })).toHaveLength(1);
  });

  it('returns products by id in the order asked, skipping unknown and paused ones', async () => {
    const rows = await catalog().getBotProductsByIds(ws, scope, [
      other.id,
      'not-a-uuid',
      paused.id,
      villa.id,
    ]);
    expect(rows.map((r) => r.code)).toEqual(['C03', 'A17']);
  });

  it('answers empty when the lodging store is unavailable', async () => {
    const down = new LodgingBotCatalog({
      run: () => Promise.reject(new LodgingUnavailableError()),
    } as LodgingStore);
    expect(await down.searchBotCatalog(ws, scope, { limit: 8 })).toEqual([]);
    expect(await down.getBotProductsByIds(ws, scope, [villa.id])).toEqual([]);
    expect(await down.countBotCatalog(ws, scope)).toBe(0);
  });
});
