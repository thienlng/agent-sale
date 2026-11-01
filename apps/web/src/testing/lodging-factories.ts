import type {
  BookingDto,
  PropertyDto,
  PropertySummary,
  RateDto,
  UnitDto,
} from '@agent-sales/contracts';

/** Test data for the lodging screens; ids are fixed uuids so assertions can name them. */
export const LODGING_IDS = {
  a17: '0193a000-0000-7000-8000-000000000001',
  a17Unit: '0193a000-0000-7000-8000-000000000011',
  h1: '0193a000-0000-7000-8000-000000000002',
  r1: '0193a000-0000-7000-8000-000000000021',
  r2: '0193a000-0000-7000-8000-000000000022',
  bk1: '0193a000-0000-7000-8000-000000000101',
  bk2: '0193a000-0000-7000-8000-000000000102',
  bk3: '0193a000-0000-7000-8000-000000000103',
  conv: '0193a000-0000-7000-8000-000000000201',
  contact: '0193a000-0000-7000-8000-000000000301',
  bot: '0193a000-0000-7000-8000-000000000401',
} as const;

const STAMP = '2026-11-01T00:00:00.000Z';

export function unitFixture(over: Partial<UnitDto> = {}): UnitDto {
  return {
    id: LODGING_IDS.a17Unit,
    kind: 'whole',
    name: 'Nguyên căn',
    beds: '',
    capacityAdults: 24,
    capacityChildren: 8,
    active: true,
    sortOrder: 0,
    ...over,
  };
}

export function weekdayRate(over: Partial<RateDto> = {}): RateDto {
  return {
    id: '0193a000-0000-7000-8000-000000000501',
    unitId: null,
    kind: 'weekday',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    dateFrom: null,
    dateTo: null,
    label: '',
    sell: 12_000_000,
    cost: 10_000_000,
    minNights: null,
    ...over,
  };
}

export function propertyFixture(over: Partial<PropertyDto> = {}): PropertyDto {
  return {
    id: LODGING_IDS.a17,
    code: 'A17',
    name: 'Villa A17 Vinpearl',
    area: 'Bãi Dài',
    address: '',
    description: '',
    sellMode: 'whole',
    status: 'active',
    standardAdults: 24,
    standardChildren: 8,
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
    internalNote: '',
    units: [unitFixture()],
    rates: [],
    surcharges: { extraAdult: null, extraChild: null },
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...over,
  };
}

export function summaryFixture(over: Partial<PropertySummary> = {}): PropertySummary {
  const { rates: _rates, ...rest } = propertyFixture();
  return { ...rest, today: 'free', ...over };
}

export function bookingFixture(over: Partial<BookingDto> = {}): BookingDto {
  return {
    id: LODGING_IDS.bk1,
    code: 'BK-0001',
    propertyId: LODGING_IDS.a17,
    propertyCode: 'A17',
    propertyName: 'Villa A17 Vinpearl',
    kind: 'stay',
    whole: true,
    unitIds: [LODGING_IDS.a17Unit],
    unitNames: ['Nguyên căn'],
    status: 'confirmed',
    checkIn: '2099-11-06',
    checkOut: '2099-11-08',
    party: { adults: 10, childAges: [5] },
    guestName: 'Anh Nam',
    guestPhone: '0912345678',
    contactId: null,
    conversationId: null,
    source: 'messenger',
    holdExpiresAt: null,
    quote: null,
    adjustment: 0,
    adjustmentReason: '',
    totalSell: 24_000_000,
    totalCost: 20_000_000,
    note: '',
    tags: [],
    blockReason: '',
    reviewedAt: null,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...over,
  };
}

type Reply = { status: number; body?: unknown };

/**
 * A fetch stub answering by "METHOD /path" (query string ignored, the full URL is
 * recorded) for the lodging screens; unknown requests throw so a test sees them.
 */
export function stubLodgingApi(routes: Record<string, Reply>) {
  const calls: Array<{ key: string; url: string; body: unknown }> = [];
  const fetchStub = async (input: string, init: RequestInit = {}) => {
    const url = input.replace('/api/v1', '');
    const key = `${init.method ?? 'GET'} ${url.split('?')[0]}`;
    calls.push({ key, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchStub, calls };
}
