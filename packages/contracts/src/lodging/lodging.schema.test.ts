import { describe, expect, it } from 'vitest';
import { AccommodationDetails } from '../commerce/lodging.schema.js';
import {
  BookingListQuery,
  BookingReviewCount,
  BookingStatusRequest,
  BookingTag,
  CreateBookingRequest,
  GalleryImage,
  normalizeBookingTag,
  normalizeBookingTags,
  OverrideInput,
  PropertyInput,
  PutNightNoteRequest,
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

describe('lodging v2 gallery images', () => {
  it('accepts https links only', () => {
    expect(GalleryImage.safeParse({ url: 'https://cdn.example.com/a.jpg' }).success).toBe(true);
    expect(GalleryImage.safeParse({ url: 'http://cdn.example.com/a.jpg' }).success).toBe(false);
    expect(GalleryImage.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
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

  it('still requires every bedroom in the layout of a whole property', () => {
    expect(AccommodationDetails.safeParse({ ...a17, bedrooms: 9 }).success).toBe(false);
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
