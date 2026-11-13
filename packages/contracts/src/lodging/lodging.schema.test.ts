import { describe, expect, it } from 'vitest';
import { AccommodationDetails, AccommodationWrite } from '../commerce/lodging.schema.js';
import {
  AvailabilityOption,
  BookingDto,
  BookingListQuery,
  BookingReviewCount,
  BookingStatusRequest,
  BookingTag,
  CalendarSegment,
  CreateBookingRequest,
  CreateOverrideRequest,
  normalizeBookingTag,
  normalizeBookingTags,
  OverrideInput,
  PackageDto,
  PackageInput,
  PropertyDto,
  PropertyInput,
  PutNightNoteRequest,
  PutRatesRequest,
  QuoteDto,
  QuoteRequest,
  QuoteWarning,
  RateDto,
  ReplaceUnitsRequest,
  StaySelection,
  UnitCategory,
  UnitDto,
  UnitInput,
  WeekdayRate,
  UpdateBookingRequest,
  UpdateOverrideRequest,
  UpdatePropertyRequest,
} from './lodging.schema.js';

const propertyId = '01a1882d-b598-7ac1-a3af-b5bf03bc4b06';
const unitId = '01a1882d-b598-7ac1-a3af-b5bf03bc4b07';
const requestId = '01a1882d-b598-7ac1-a3af-b5bf03bc4b08';

describe('lodging v2 property input', () => {
  const base = {
    code: 'A17',
    name: 'Sky Villa A17',
    sellMode: 'whole',
    standardAdults: 24,
    standardChildren: 8,
  };

  it('applies defaults to a minimal property', () => {
    const parsed = PropertyInput.parse(base);
    expect(parsed.status).toBe('active');
    expect(parsed.childFreeBelow).toBe(6);
    expect(parsed.childAdultFrom).toBe(12);
    expect(parsed.policies.deposit).toBe('');
    expect(parsed.maxGuests).toBeNull();
  });

  it('rejects a free-child age above the adult age', () => {
    expect(
      PropertyInput.safeParse({ ...base, childFreeBelow: 13, childAdultFrom: 12 }).success,
    ).toBe(false);
  });

  it('rejects codes with spaces or symbols', () => {
    expect(PropertyInput.safeParse({ ...base, code: 'A 17' }).success).toBe(false);
  });
});

describe('lodging v2 property patch', () => {
  it('keeps omitted fields absent instead of filling create defaults', () => {
    expect(UpdatePropertyRequest.parse({ version: 1, patch: { name: 'X' } }).patch).toEqual({
      name: 'X',
    });
  });

  it('still validates the fields that are sent', () => {
    expect(UpdatePropertyRequest.safeParse({ version: 1, patch: { code: 'A 17' } }).success).toBe(
      false,
    );
    expect(UpdatePropertyRequest.parse({ version: 1, patch: { maxGuests: null } }).patch).toEqual({
      maxGuests: null,
    });
  });
});

describe('lodging v2 override patch', () => {
  it('keeps omitted fields absent, so minNights is not reset to null', () => {
    expect(UpdateOverrideRequest.parse({ version: 2, sell: 5 })).toEqual({ version: 2, sell: 5 });
  });

  it('still defaults minNights on create', () => {
    const base = { unitId: null, dateFrom: '2027-02-05', dateTo: '2027-02-06', label: 'Tết' };
    expect(OverrideInput.parse({ ...base, sell: 1, cost: 1 }).minNights).toBeNull();
  });
});

describe('lodging v2 bookings', () => {
  const selection = {
    propertyId,
    whole: true,
    checkIn: '2026-11-06',
    checkOut: '2026-11-08',
    clientRequestId: requestId,
  };

  it('parses a stay hold with defaults', () => {
    const parsed = CreateBookingRequest.parse({
      ...selection,
      kind: 'stay',
      status: 'hold',
      party: { adults: 20, childAges: [3, 7] },
      guestName: 'Nguyen Van A',
      source: 'messenger',
    });
    expect(parsed.kind).toBe('stay');
    if (parsed.kind !== 'stay') throw new Error('expected stay');
    expect(parsed.adjustment).toBe(0);
    expect(parsed.unitIds).toEqual([]);
    expect(parsed.manualTotalSell).toBeNull();
  });

  it('parses a block with a reason', () => {
    const parsed = CreateBookingRequest.parse({
      ...selection,
      whole: false,
      unitIds: [unitId],
      kind: 'block',
      blockReason: 'Maintenance',
    });
    expect(parsed.kind).toBe('block');
  });

  it('rejects a block without a reason', () => {
    expect(CreateBookingRequest.safeParse({ ...selection, kind: 'block' }).success).toBe(false);
    expect(
      CreateBookingRequest.safeParse({ ...selection, kind: 'block', blockReason: '   ' }).success,
    ).toBe(false);
  });

  it('rejects impossible nights', () => {
    expect(
      CreateBookingRequest.safeParse({
        ...selection,
        checkIn: '2027-02-30',
        kind: 'block',
        blockReason: 'x',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown status action', () => {
    expect(BookingStatusRequest.safeParse({ version: 1, action: 'teleport' }).success).toBe(false);
    expect(BookingStatusRequest.parse({ version: 1, action: 'cancel' }).reason).toBe('');
  });
});

describe('accommodation details stay backward compatible', () => {
  const layoutRow = (name: string) => ({ name, beds: '1 giường 1,8 m × 2 m + đệm phụ' });
  /** The A17 object stored in products.accommodation today (T-155 shape). */
  const a17 = {
    rentalType: 'entire_property',
    bedrooms: 8,
    standardAdults: 24,
    standardChildren: 8,
    childAgeBelow: 6,
    maxGuests: null,
    roomLayout: [
      'Tầng hầm',
      'Phòng 101',
      'Phòng 102',
      'Phòng 201',
      'Phòng 202',
      'Phòng 203',
      'Phòng 301',
      'Phòng tập thể',
    ].map(layoutRow),
    amenities: ['Bể bơi vô cực tràn bờ, view sân golf Tam Đảo', 'Phòng karaoke'],
    rateBasis: 'unconfirmed',
    rates: [
      { days: [1, 2, 3, 4], amount: 12_000_000 },
      { days: [5, 7], amount: 13_000_000 },
      { days: [6], amount: 14_000_000 },
    ],
    checkInOut: '',
    depositPolicy: '',
    cancellationPolicy: '',
    extraGuestPolicy: '',
    holidayPolicy: '',
    gallery: [{ url: 'https://cdn.example.com/a17/01.jpg', caption: 'A17 · Mặt tiền và lối vào' }],
    notes: 'Một căn nguyên căn.',
  };

  it('still parses the stored A17 object', () => {
    expect(AccommodationDetails.safeParse(a17).success).toBe(true);
  });

  it('still requires every bedroom in the layout of a whole property when it is written', () => {
    // VL-A5: the rule moved to the write schema; the read shape may omit `bedrooms` for the bot.
    expect(AccommodationWrite.safeParse({ ...a17, bedrooms: 9 }).success).toBe(false);
    expect(AccommodationWrite.safeParse(a17).success).toBe(true);
  });

  it('parses a rooms property whose layout lists fewer rows than bedrooms', () => {
    const rooms = {
      ...a17,
      rentalType: 'rooms',
      bedrooms: 5,
      roomLayout: ['P1', 'P2', 'P3'].map(layoutRow),
      rateBasis: 'night',
      code: 'HS1',
      units: [
        {
          name: 'P1',
          beds: '1 giường đôi',
          capacityAdults: 2,
          capacityChildren: 1,
          weekdayRates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 1_200_000 }],
        },
      ],
      overrides: [
        {
          dateFrom: '2027-02-05',
          dateTo: '2027-02-08',
          label: 'Tết',
          amount: 2_000_000,
          unitName: 'P1',
        },
      ],
      surcharges: { extraAdult: 300_000, extraChild: null, childFreeBelow: 6, childAdultFrom: 12 },
    };
    expect(AccommodationDetails.safeParse(rooms).success).toBe(true);
  });

  it('carries unit details, unit albums and bedroom packages (T-193)', () => {
    const pkg = (name: string, bedrooms: number, saturday: boolean) => ({
      name,
      bedrooms,
      standardAdults: bedrooms * 2,
      standardChildren: 0,
      maxGuests: bedrooms * 2 + 2,
      weekdaySell: [1, 2, 3, 4, 5, 6, 7].map((d) =>
        d === 6 && !saturday ? null : bedrooms * 1_000_000,
      ),
    });
    const parsed = AccommodationDetails.parse({
      ...a17,
      rentalType: 'rooms',
      packages: [pkg('4PN', 4, false), pkg('6PN', 6, true)],
      units: [
        {
          name: 'Bungalow 1',
          beds: '1 giường đôi',
          capacityAdults: 2,
          capacityChildren: 1,
          weekdayRates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 1_200_000 }],
          category: 'bungalow',
          view: 'đồi',
          areaM2: 40,
          description: 'Bungalow gỗ',
          amenities: ['Bồn tắm'],
          maxGuests: 3,
          albums: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Bungalow 1',
              items: [{ kind: 'image', url: 'https://cdn.example.com/b1.jpg', caption: '' }],
            },
          ],
          packages: [pkg('1PN', 1, true)],
        },
      ],
    });
    expect(parsed.packages?.[0]?.weekdaySell[5]).toBeNull();
    expect(parsed.units?.[0]).toMatchObject({ category: 'bungalow', view: 'đồi', maxGuests: 3 });
    expect(parsed.units?.[0]?.albums).toHaveLength(1);
    expect(parsed.units?.[0]?.packages?.[0]?.name).toBe('1PN');
    // A package lists exactly the seven weekdays.
    expect(
      AccommodationDetails.safeParse({
        ...a17,
        packages: [{ ...pkg('4PN', 4, true), weekdaySell: [1, 2, 3] }],
      }).success,
    ).toBe(false);
  });
});

describe('lodging calendar polish: night notes, internal note, tags', () => {
  it('trims a night note, defaults the room to the property and caps it at 300 chars', () => {
    expect(PutNightNoteRequest.parse({ night: '2027-01-01', text: '  Sửa điện  ' })).toEqual({
      unitId: null,
      night: '2027-01-01',
      text: 'Sửa điện',
    });
    expect(PutNightNoteRequest.parse({ unitId, night: '2027-01-01', text: '' }).text).toBe('');
    expect(
      PutNightNoteRequest.safeParse({ night: '2027-01-01', text: 'x'.repeat(301) }).success,
    ).toBe(false);
  });

  it('defaults the internal note to empty and caps it at 2000 chars', () => {
    const base = {
      code: 'A17',
      name: 'A17',
      sellMode: 'whole',
      standardAdults: 2,
      standardChildren: 0,
    };
    expect(PropertyInput.parse(base).internalNote).toBe('');
    expect(PropertyInput.safeParse({ ...base, internalNote: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('accepts up to 8 tags of at most 30 chars on create, edit and the list filter', () => {
    const stay = {
      kind: 'stay',
      clientRequestId: requestId,
      propertyId,
      whole: true,
      checkIn: '2027-01-01',
      checkOut: '2027-01-02',
      status: 'hold',
      party: { adults: 2 },
      guestName: 'Khách',
      source: 'phone',
    };
    const created = CreateBookingRequest.parse(stay);
    expect(created.kind === 'stay' && created.tags).toEqual([]);
    expect(CreateBookingRequest.safeParse({ ...stay, tags: ['x'.repeat(31)] }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => `t${i}`);
    expect(UpdateBookingRequest.safeParse({ version: 1, tags: nine }).success).toBe(false);
    expect(UpdateBookingRequest.safeParse({ version: 1, tags: nine.slice(0, 8) }).success).toBe(
      true,
    );
    expect(BookingListQuery.parse({ tag: 'Đã cọc' }).tag).toBe('Đã cọc');
  });

  it('stores tags NFC-normalised, so an NFD "Đã cọc" equals the NFC suggestion and filter', () => {
    const nfc = 'Đã cọc'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(BookingTag.parse(` ${nfd} `)).toBe(nfc);
    expect(BookingListQuery.parse({ tag: nfd }).tag).toBe(nfc);
    expect(UpdateBookingRequest.parse({ version: 1, tags: [nfd] }).tags).toEqual([nfc]);
    expect(normalizeBookingTag(` ${nfd}`)).toBe(nfc);
    expect(normalizeBookingTags([nfc, ` ${nfd} `, '', 'VIP'])).toEqual([nfc, 'VIP']);
  });
});

describe('bot holds review (T-161)', () => {
  it('filters bookings by source and counts bot holds to review', () => {
    expect(BookingListQuery.parse({ source: 'bot' }).source).toBe('bot');
    expect(BookingListQuery.safeParse({ source: 'robot' }).success).toBe(false);
    expect(BookingReviewCount.parse({ pending: 2 })).toEqual({ pending: 2 });
    expect(BookingReviewCount.safeParse({ pending: -1 }).success).toBe(false);
  });
});

describe('lodging units and packages (T-193)', () => {
  const WS = '0192f0a0-0000-7000-8000-000000000001';
  const IMG = `/media/products/${WS}/0192f0a0-0000-7000-8000-0000000000aa.jpg`;
  const packageId = '01a1882d-b598-7ac1-a3af-b5bf03bc4b09';
  const unit = { name: 'Bungalow 1', capacityAdults: 2 };

  it('lists the unit categories', () => {
    expect(UnitCategory.options).toEqual(['room', 'bungalow', 'house', 'other']);
  });

  it('applies the new unit defaults', () => {
    const parsed = UnitInput.parse(unit);
    expect(parsed).toMatchObject({
      category: 'room',
      view: '',
      areaM2: null,
      description: '',
      amenities: [],
      maxGuests: null,
      gallery: [],
      galleryCover: '',
    });
    expect(ReplaceUnitsRequest.parse({ version: 1, units: [unit] }).units[0]?.category).toBe(
      'room',
    );
  });

  it('validates the unit detail limits', () => {
    const bad = (patch: object) => UnitInput.safeParse({ ...unit, ...patch }).success;
    expect(bad({ view: 'x'.repeat(200), areaM2: 100000, maxGuests: 2000 })).toBe(true);
    expect(bad({ view: 'x'.repeat(201) })).toBe(false);
    expect(bad({ description: 'x'.repeat(2001) })).toBe(false);
    expect(bad({ areaM2: 0 })).toBe(false);
    expect(bad({ areaM2: 100001 })).toBe(false);
    expect(bad({ maxGuests: 2001 })).toBe(false);
    expect(bad({ amenities: Array.from({ length: 41 }, (_, i) => `a${i}`) })).toBe(false);
    expect(bad({ amenities: ['x'.repeat(201)] })).toBe(false);
    expect(bad({ category: 'tent' })).toBe(false);
  });

  it('requires a unit cover to be an image of the unit gallery', () => {
    const gallery = [{ id: 'f1', name: 'Phòng', items: [{ kind: 'image', url: IMG }] }];
    expect(UnitInput.safeParse({ ...unit, gallery, galleryCover: IMG }).success).toBe(true);
    const r = UnitInput.safeParse({ ...unit, gallery: [], galleryCover: IMG });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['galleryCover']);
  });

  it('parses a package with defaults and limits', () => {
    const pkg = { key: 'p6', unitId: null, name: ' 6PN ', bedrooms: 6, standardAdults: 12 };
    expect(PackageInput.parse(pkg)).toEqual({
      key: 'p6',
      unitId: null,
      name: '6PN',
      bedrooms: 6,
      standardAdults: 12,
      standardChildren: 0,
      maxGuests: null,
    });
    const ok = (patch: object) => PackageInput.safeParse({ ...pkg, ...patch }).success;
    expect(ok({ key: 'k'.repeat(40), name: 'n'.repeat(50), id: packageId })).toBe(true);
    expect(ok({ key: '' })).toBe(false);
    expect(ok({ key: 'k'.repeat(41) })).toBe(false);
    expect(ok({ name: '   ' })).toBe(false);
    expect(ok({ name: 'n'.repeat(51) })).toBe(false);
    expect(ok({ bedrooms: 0 })).toBe(false);
    expect(ok({ bedrooms: 101 })).toBe(false);
    expect(ok({ standardAdults: 0 })).toBe(false);
    expect(ok({ standardChildren: 1001 })).toBe(false);
    expect(ok({ maxGuests: 2001 })).toBe(false);
    expect(ok({ id: 'not-a-uuid' })).toBe(false);
  });

  it('defaults rate package keys and request packages', () => {
    const weekday = { unitId: null, weekdays: [1, 2, 3, 4, 5, 6, 7], sell: 10, cost: 5 };
    expect(WeekdayRate.parse(weekday).packageKey).toBeNull();
    const put = PutRatesRequest.parse({
      version: 1,
      weekday: [weekday],
      surcharges: { extraAdult: null, extraChild: null },
    });
    expect(put.packages).toEqual([]);
    expect(put.weekday[0]?.packageKey).toBeNull();
  });

  it('caps the packages of a rates request at 200', () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      key: `k${i}`,
      unitId: null,
      name: `${i}PN`,
      bedrooms: 1,
      standardAdults: 1,
    }));
    const r = PutRatesRequest.safeParse({
      version: 1,
      weekday: [{ unitId: null, weekdays: [1], sell: 1, cost: 1 }],
      surcharges: { extraAdult: null, extraChild: null },
      packages: many,
    });
    expect(r.success).toBe(false);
  });

  it('defaults an override package to null on create only', () => {
    const base = { unitId, dateFrom: '2026-12-24', dateTo: '2026-12-25', label: 'Noel' };
    expect(OverrideInput.parse({ ...base, sell: 1, cost: 1 }).packageId).toBeNull();
    expect(
      CreateOverrideRequest.parse({ ...base, sell: 1, cost: 1, version: 1, packageId }).packageId,
    ).toBe(packageId);
    expect(UpdateOverrideRequest.parse({ version: 2, packageId: null })).toEqual({
      version: 2,
      packageId: null,
    });
  });

  it('defaults the selected packages of a stay to none', () => {
    const stay = {
      propertyId,
      whole: true,
      checkIn: '2026-12-01',
      checkOut: '2026-12-02',
    };
    expect(StaySelection.parse(stay).packageIds).toEqual([]);
    expect(
      QuoteRequest.parse({ ...stay, party: { adults: 2 }, packageIds: [packageId] }).packageIds,
    ).toEqual([packageId]);
    expect(
      StaySelection.safeParse({ ...stay, packageIds: Array.from({ length: 101 }, () => packageId) })
        .success,
    ).toBe(false);
    const created = CreateBookingRequest.parse({
      ...stay,
      kind: 'block',
      clientRequestId: requestId,
      blockReason: 'Sửa',
    });
    expect(created.packageIds).toEqual([]);
    expect(UpdateBookingRequest.parse({ version: 1, packageIds: [packageId] }).packageIds).toEqual([
      packageId,
    ]);
    expect(UpdateBookingRequest.parse({ version: 1 })).toEqual({ version: 1 });
  });

  it('carries packages on the quote and the package_unavailable warning', () => {
    expect(QuoteWarning.options).toContain('package_unavailable');
    const quote = {
      nights: [],
      surcharges: [],
      totalSell: null,
      totalCost: null,
      warnings: ['package_unavailable'],
      takenBy: [],
      packages: [{ target: null, packageId, name: '4PN' }],
    };
    expect(QuoteDto.parse(quote).packages).toHaveLength(1);
    const { packages: _omit, ...withoutPackages } = quote;
    expect(QuoteDto.safeParse(withoutPackages).success).toBe(false);
    const option = AvailabilityOption.parse({
      propertyId,
      whole: true,
      unitIds: [],
      fits: true,
      quote,
      packages: quote.packages,
      alternatives: [{ packageId, name: '6PN', bedrooms: 6, totalSell: null, fits: true }],
    });
    expect(option.alternatives[0]?.name).toBe('6PN');
  });

  it('describes packages, unit details and package rates in DTOs', () => {
    const pkg = {
      id: packageId,
      unitId: null,
      name: '5PN',
      bedrooms: 5,
      standardAdults: 10,
      standardChildren: 0,
      maxGuests: 12,
      sortOrder: 1,
    };
    expect(PackageDto.parse(pkg)).toEqual(pkg);
    expect(PropertyDto.shape.packages).toBeDefined();
    expect(UnitDto.shape.category).toBeDefined();
    expect(UnitDto.shape.gallery).toBeDefined();
    expect(RateDto.shape.packageId).toBeDefined();
    expect(BookingDto.shape.packageIds).toBeDefined();
    expect(BookingDto.shape.packageNames).toBeDefined();
    expect(CalendarSegment.shape.packageNames).toBeDefined();
  });
});
