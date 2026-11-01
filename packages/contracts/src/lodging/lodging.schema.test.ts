import { describe, expect, it } from 'vitest';
import { AccommodationDetails } from '../commerce/lodging.schema.js';
import { BookingStatusRequest, CreateBookingRequest, PropertyInput } from './lodging.schema.js';

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
