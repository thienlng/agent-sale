import type { CalendarDto, PropertyDto, QuoteDto } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithRouter } from '@/testing/render';

import { CalendarPage } from './calendar-page';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const A17 = '0193a000-0000-7000-8000-000000000001';
const A17_UNIT = '0193a000-0000-7000-8000-000000000011';
const H1 = '0193a000-0000-7000-8000-000000000002';
const R1 = '0193a000-0000-7000-8000-000000000021';
const R2 = '0193a000-0000-7000-8000-000000000022';
const BK1 = '0193a000-0000-7000-8000-000000000101';
const BK2 = '0193a000-0000-7000-8000-000000000102';
const FROM = '2026-11-02'; // a Monday

const nights = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 10, 2 + i));
  return d.toISOString().slice(0, 10);
});
const sellOf = (night: string) => {
  const wd = new Date(`${night}T00:00:00Z`).getUTCDay();
  return wd === 5 ? 13_000_000 : wd === 6 ? 14_000_000 : 12_000_000;
};

const calendar: CalendarDto = {
  from: FROM,
  to: '2026-11-16',
  today: FROM,
  properties: [
    {
      id: A17,
      code: 'A17',
      name: 'Villa A17 Vinpearl',
      area: 'Bãi Dài',
      sellMode: 'whole',
      standardAdults: 24,
      standardChildren: 8,
      wholePrices: nights.map((night) => ({ night, sell: sellOf(night), label: '' })),
      rows: [
        {
          unitId: A17_UNIT,
          name: 'Nguyên căn',
          kind: 'whole',
          prices: nights.map((night) => ({ night, sell: sellOf(night), label: '' })),
          segments: [
            {
              bookingId: BK1,
              code: 'BK-0001',
              kind: 'stay',
              status: 'confirmed',
              from: '2026-11-06',
              to: '2026-11-08',
              guestName: 'Anh Nam',
              blockReason: '',
              holdExpiresAt: null,
            },
          ],
        },
      ],
    },
    {
      id: H1,
      code: 'H1',
      name: 'Homestay Hoa Sứ',
      area: 'Dương Đông',
      sellMode: 'rooms',
      standardAdults: 4,
      standardChildren: 2,
      wholePrices: nights.map((night) => ({ night, sell: 1_200_000, label: '' })),
      rows: [
        {
          unitId: R1,
          name: 'P101',
          kind: 'room',
          prices: nights.map((night) => ({ night, sell: 600_000, label: '' })),
          segments: [
            {
              bookingId: BK2,
              code: 'BK-0002',
              kind: 'stay',
              status: 'hold',
              from: '2026-11-03',
              to: '2026-11-04',
              guestName: 'Chị Lan',
              blockReason: '',
              holdExpiresAt: '2026-11-03T07:30:00.000Z',
            },
          ],
        },
        {
          unitId: R2,
          name: 'P102',
          kind: 'room',
          prices: nights.map((night) => ({ night, sell: 600_000, label: '' })),
          segments: [],
        },
      ],
    },
  ],
};

const property: PropertyDto = {
  id: A17,
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
  units: [
    {
      id: A17_UNIT,
      kind: 'whole',
      name: 'Nguyên căn',
      beds: '',
      capacityAdults: 24,
      capacityChildren: 8,
      active: true,
      sortOrder: 0,
    },
  ],
  rates: [],
  surcharges: { extraAdult: null, extraChild: null },
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const quote: QuoteDto = {
  nights: ['2026-11-02', '2026-11-03', '2026-11-04'].map((date) => ({
    date,
    weekday: 1,
    label: '',
    sell: 12_000_000,
    cost: 10_000_000,
  })),
  surcharges: [],
  totalSell: 36_000_000,
  totalCost: 30_000_000,
  warnings: [],
  takenBy: [],
};

const created = {
  id: BK1,
  code: 'BK-0003',
  propertyId: A17,
  propertyCode: 'A17',
  propertyName: 'Villa A17 Vinpearl',
  kind: 'stay',
  whole: true,
  unitIds: [A17_UNIT],
  unitNames: ['Nguyên căn'],
  status: 'hold',
  checkIn: '2026-11-02',
  checkOut: '2026-11-05',
  party: { adults: 2, childAges: [] },
  guestName: 'Anh Minh',
  guestPhone: '',
  contactId: null,
  conversationId: null,
  source: 'phone',
  holdExpiresAt: '2026-11-02T10:00:00.000Z',
  quote,
  adjustment: 0,
  adjustmentReason: '',
  totalSell: 36_000_000,
  totalCost: 30_000_000,
  note: '',
  blockReason: '',
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  history: [],
};

type Reply = { status: number; body?: unknown };
/** Answers by "METHOD /path" (query string ignored) and records every call. */
function stubApi(overrides: Record<string, Reply> = {}) {
  const routes: Record<string, Reply> = {
    'GET /lodging/calendar': { status: 200, body: calendar },
    'GET /lodging/properties': { status: 200, body: { data: [] } },
    [`GET /lodging/properties/${A17}`]: { status: 200, body: property },
    'POST /lodging/quote': { status: 200, body: quote },
    ...overrides,
  };
  const calls: Array<{ key: string; url: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = input.replace('/api/v1', '');
    const key = `${init.method ?? 'GET'} ${url.split('?')[0]}`;
    calls.push({ key, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

function renderPage() {
  return renderWithRouter(() => (
    <TooltipProvider>
      <CalendarPage initialFrom={FROM} />
    </TooltipProvider>
  ));
}

const cell = (name: RegExp) => screen.findByRole('button', { name });

describe('CalendarPage', () => {
  it('shows nightly prices and booking bars with their status text', async () => {
    const calls = stubApi();
    renderPage();
    const monday = await cell(/^A17, Thứ Hai 02\/11, trống/);
    expect(monday).toHaveTextContent('12tr');
    expect(screen.getByText('Anh Nam · BK-0001')).toBeInTheDocument();
    expect(screen.getAllByText('Đã đặt').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: /^A17, Thứ Sáu 06\/11, Đã đặt BK-0001/ }),
    ).toBeInTheDocument();
    expect(calls[0]?.url).toBe('/lodging/calendar?from=2026-11-02&to=2026-11-16');
  });

  it('labels a hold with text, not only colour', async () => {
    stubApi();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Xem từng phòng của H1/ }));
    expect(screen.getByText('Chị Lan · BK-0002')).toBeInTheDocument();
    expect(screen.getByText(/Giữ chỗ · hết hạn/)).toBeInTheDocument();
  });

  it('selects two nights, opens the sheet and posts a hold', async () => {
    const calls = stubApi({
      'POST /lodging/bookings': {
        status: 201,
        body: created,
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await cell(/^A17, Thứ Hai 02\/11, trống/));
    await user.click(await cell(/^A17, Thứ Tư 04\/11, trống/));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByLabelText('Nhận phòng')).toHaveValue('2026-11-02');
    expect(within(sheet).getByLabelText('Trả phòng')).toHaveValue('2026-11-05');
    await waitFor(() =>
      expect(within(sheet).getByTestId('quote-total')).toHaveTextContent(/36\.000\.000/),
    );
    await user.type(within(sheet).getByLabelText('Tên khách'), 'Anh Minh');
    await user.click(within(sheet).getByRole('button', { name: 'Giữ chỗ' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /lodging/bookings')).toBe(true));
    const post = calls.find((c) => c.key === 'POST /lodging/bookings');
    expect(post?.body).toMatchObject({
      kind: 'stay',
      status: 'hold',
      propertyId: A17,
      whole: true,
      checkIn: '2026-11-02',
      checkOut: '2026-11-05',
      guestName: 'Anh Minh',
      source: 'phone',
      party: { adults: 2, childAges: [] },
    });
    expect((post?.body as { clientRequestId: string }).clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('shows the blocking booking codes on a 409 and reloads the calendar', async () => {
    const calls = stubApi({
      'POST /lodging/bookings': {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'taken',
            details: { reason: 'NIGHTS_TAKEN', codes: ['BK-0001'] },
          },
        },
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await cell(/^A17, Thứ Hai 02\/11, trống/));
    await user.click(await cell(/^A17, Thứ Tư 04\/11, trống/));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Tên khách'), 'Anh Minh');
    const before = calls.filter((c) => c.key === 'GET /lodging/calendar').length;
    await user.click(within(sheet).getByRole('button', { name: 'Giữ chỗ' }));
    expect(await within(sheet).findByText(/BK-0001/)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'GET /lodging/calendar').length).toBeGreaterThan(before),
    );
  });

  it('highlights rows that fit a search and dims the others', async () => {
    const calls = stubApi({
      'POST /lodging/availability': {
        status: 200,
        body: {
          options: [
            {
              propertyId: A17,
              whole: true,
              unitIds: [A17_UNIT],
              fits: true,
              quote: { ...quote, totalSell: 27_000_000 },
            },
          ],
        },
      },
    });
    const user = userEvent.setup();
    renderPage();
    await cell(/^A17, Thứ Hai 02\/11, trống/);
    const find = screen.getByRole('search');
    await user.type(within(find).getByLabelText('Nhận phòng'), '2026-11-09');
    await user.type(within(find).getByLabelText('Trả phòng'), '2026-11-11');
    await user.click(within(find).getByRole('button', { name: 'Tìm' }));
    const hold = await screen.findByRole('button', { name: /Giữ chỗ · 27\.000\.000/ });
    expect(hold.closest('[data-property]')).toHaveAttribute('data-fit', 'true');
    const h1 = document.querySelector(`[data-property="${H1}"]`);
    expect(h1).toHaveClass('opacity-50');
    expect(calls.find((c) => c.key === 'POST /lodging/availability')?.body).toEqual({
      checkIn: '2026-11-09',
      checkOut: '2026-11-11',
      party: { adults: 2, childAges: [] },
    });
    await user.click(hold);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByLabelText('Nhận phòng')).toHaveValue('2026-11-09');
    expect(within(sheet).getByLabelText('Trả phòng')).toHaveValue('2026-11-11');
  });

  it('moves focus between cells with the arrow keys', async () => {
    stubApi();
    const user = userEvent.setup();
    renderPage();
    const monday = await cell(/^A17, Thứ Hai 02\/11, trống/);
    monday.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /^A17, Thứ Ba 03\/11, trống/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName(/^H1, Thứ Ba 03\/11/);
  });
});
