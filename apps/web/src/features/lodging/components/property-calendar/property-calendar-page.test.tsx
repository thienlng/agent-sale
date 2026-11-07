import type { BookingDto, CalendarDto, PropertyDto, QuoteDto } from '@agent-sales/contracts';
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithRouter } from '@/testing/render';

import type { PropertyCalendarSearch } from '../../lib/property-calendar-model';
import { PropertyCalendarPage } from './property-calendar-page';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
// A month grid renders ~50 named buttons; give `findBy` room on a loaded worker.
configure({ asyncUtilTimeout: 5000 });
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
/** Extra bookings on A17 for one test; reset after each. */
const extra = vi.hoisted(() => ({ segments: [] as unknown[], hangFrom: '' }));
afterEach(() => {
  can.value = true;
  extra.segments = [];
  extra.hangFrom = '';
  vi.useRealTimers();
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
const CONV = '0193a000-0000-7000-8000-000000000401';

const DAY = 86_400_000;
const utc = (n: string) => Date.UTC(+n.slice(0, 4), +n.slice(5, 7) - 1, +n.slice(8, 10));
const nightsOf = (from: string, to: string) =>
  Array.from({ length: Math.round((utc(to) - utc(from)) / DAY) }, (_, i) =>
    new Date(utc(from) + i * DAY).toISOString().slice(0, 10),
  );
const sellOf = (night: string) => {
  const wd = new Date(`${night}T00:00:00Z`).getUTCDay();
  return wd === 5 ? 13_000_000 : wd === 6 ? 14_000_000 : 12_000_000;
};

const segment = {
  packageNames: [],
  kind: 'stay' as const,
  blockReason: '',
  guestPhone: '0912345678',
  party: { adults: 2, childAges: [] },
  tags: [],
  note: '',
};

/** The calendar of one property for any window (bookings clipped like the server does). */
function calendarFor(id: string, from: string, to: string): CalendarDto {
  const nights = nightsOf(from, to);
  const clip = <T extends { from: string; to: string }>(s: T[]) =>
    s
      .filter((x) => x.from < to && x.to > from)
      .map((x) => ({ ...x, from: x.from < from ? from : x.from, to: x.to > to ? to : x.to }));
  const prices = nights.map((night) => ({
    night,
    sell: sellOf(night),
    label: night === '2026-11-20' ? 'Lễ hội' : '',
  }));
  if (id === H1)
    return {
      from,
      to,
      today: '2026-11-02',
      properties: [
        {
          id: H1,
          code: 'H1',
          name: 'Homestay Hoa Sứ',
          area: '',
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
              segments: clip([
                {
                  ...segment,
                  bookingId: BK2,
                  code: 'BK-0002',
                  status: 'hold' as const,
                  from: '2026-11-03',
                  to: '2026-11-04',
                  guestName: 'Chị Lan',
                  holdExpiresAt: '2026-11-03T07:30:00.000Z',
                  totalSell: 600_000,
                },
              ]),
            },
            {
              unitId: R2,
              name: 'P102',
              kind: 'room',
              prices: nights.map((night) => ({ night, sell: 600_000, label: '' })),
              segments: [],
            },
          ],
          internalNote: '',
          notes: [],
        },
      ],
    };
  return {
    from,
    to,
    today: '2026-11-02',
    properties: [
      {
        id: A17,
        code: 'A17',
        name: 'Villa A17 Vinpearl',
        area: 'Bãi Dài',
        sellMode: 'whole',
        standardAdults: 24,
        standardChildren: 8,
        wholePrices: prices,
        rows: [
          {
            unitId: A17_UNIT,
            name: 'Nguyên căn',
            kind: 'whole',
            prices,
            segments: clip([
              {
                ...segment,
                bookingId: BK1,
                code: 'BK-0001',
                status: 'confirmed' as const,
                from: '2026-11-06',
                to: '2026-11-08',
                guestName: 'Anh Nam',
                holdExpiresAt: null,
                totalSell: 26_000_000,
              },
              ...(extra.segments as Array<
                CalendarDto['properties'][number]['rows'][number]['segments'][number]
              >),
            ]),
          },
        ],
        internalNote: 'Chủ nhà: gọi trước 21h',
        notes: [
          {
            id: '0193a000-0000-7000-8000-000000000301',
            unitId: null,
            night: '2026-11-03',
            text: 'Sửa điện',
          },
        ],
      },
    ],
  };
}

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
  galleryCover: '',
  internalNote: '',
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
      category: 'room',
      view: '',
      areaM2: null,
      description: '',
      amenities: [],
      maxGuests: null,
      gallery: [],
      galleryCover: '',
    },
  ],
  rates: [],
  packages: [],
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
  packages: [],
};

const booking: BookingDto = {
  id: BK1,
  code: 'BK-0001',
  propertyId: A17,
  propertyCode: 'A17',
  propertyName: 'Villa A17 Vinpearl',
  kind: 'stay',
  whole: true,
  unitIds: [A17_UNIT],
  unitNames: ['Nguyên căn'],
  packageIds: [],
  packageNames: ['5PN'],
  status: 'hold',
  checkIn: '2026-11-06',
  checkOut: '2026-11-08',
  party: { adults: 2, childAges: [] },
  guestName: 'Anh Nam',
  guestPhone: '0912345678',
  contactId: null,
  conversationId: CONV,
  source: 'bot',
  holdExpiresAt: '2099-11-06T10:00:00.000Z',
  quote,
  adjustment: 0,
  adjustmentReason: '',
  totalSell: 26_000_000,
  totalCost: 20_000_000,
  note: '',
  tags: [],
  blockReason: '',
  reviewedAt: null,
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

type Reply = { status: number; body?: unknown };
/** Answers by "METHOD /path"; the calendar answers the asked window. Records every call. */
function stubApi(overrides: Record<string, Reply> = {}) {
  const routes: Record<string, Reply> = {
    'GET /lodging/bookings': { status: 200, body: { data: [booking], nextOffset: null } },
    [`GET /lodging/bookings/${BK1}`]: { status: 200, body: { ...booking, history: [] } },
    'GET /lodging/properties': { status: 200, body: { data: [] } },
    [`GET /lodging/properties/${A17}`]: { status: 200, body: property },
    'POST /lodging/quote': { status: 200, body: quote },
    ...overrides,
  };
  const calls: Array<{ key: string; url: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = input.replace('/api/v1', '');
    const [path = '', query = ''] = url.split('?');
    const key = `${init.method ?? 'GET'} ${path}`;
    calls.push({ key, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (key === 'GET /lodging/calendar') {
      const q = new URLSearchParams(query);
      // A window that never answers, to look at the page while it loads.
      if (extra.hangFrom && q.get('from') === extra.hangFrom)
        return new Promise<Response>(() => {});
      const body = calendarFor(q.get('propertyIds') ?? A17, q.get('from') ?? '', q.get('to') ?? '');
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

/** Renders the page with the search in state, as the route keeps it in the URL. */
function renderPage(propertyId = A17, initial: PropertyCalendarSearch = { from: '2026-11-01' }) {
  const onSearch = vi.fn();
  function Harness() {
    const [search, setSearch] = useState(initial);
    return (
      <TooltipProvider>
        <PropertyCalendarPage
          propertyId={propertyId}
          search={search}
          onSearch={(next, options) => {
            if (options) onSearch(next, options);
            else onSearch(next);
            setSearch(next);
          }}
        />
      </TooltipProvider>
    );
  }
  renderWithRouter(() => <Harness />);
  return onSearch;
}

const cell = (name: RegExp) => screen.findByRole('button', { name });

describe('PropertyCalendarPage — month', () => {
  it('asks for the month grid of one property and shows prices, labels and a booking bar', async () => {
    const calls = stubApi();
    renderPage();
    const monday = await cell(/^Thứ Hai 02\/11, trống/);
    expect(monday).toHaveTextContent('12tr');
    expect(calls.map((c) => c.url)).toContain(
      `/lodging/calendar?from=2026-10-25&to=2026-12-07&propertyIds=${A17}`,
    );
    expect(screen.getByRole('heading', { name: /A17/ })).toHaveTextContent('Villa A17 Vinpearl');
    expect(screen.getByText('Lễ hội')).toBeInTheDocument();
    // The bar spans Friday 06/11 and Saturday 07/11 (columns 5–6 of the week).
    const label = screen.getByText('Anh Nam · BK-0001');
    expect(label.parentElement).toHaveStyle({ gridColumn: '5 / 7' });
    expect(screen.getByRole('button', { name: /^Thứ Sáu 06\/11, Đã đặt BK-0001/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Thứ Bảy 07\/11, Đã đặt BK-0001/ })).toBeVisible();
    // The night note marks its day.
    const tuesday = screen.getByRole('button', {
      name: /Thứ Ba 03\/11, trống, .*có ghi chú: Sửa điện$/,
    });
    expect(tuesday.querySelector('[data-note-dot]')).not.toBeNull();
  });

  it('selects free nights and opens the create sheet for this property', async () => {
    stubApi();
    const user = userEvent.setup();
    renderPage();
    await user.click(await cell(/^Thứ Hai 02\/11, trống/));
    expect(screen.getByRole('status')).toHaveTextContent('02/11');
    await user.click(await cell(/^Thứ Tư 04\/11, trống/));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByLabelText('Nhận phòng')).toHaveValue('2026-11-02');
    expect(within(sheet).getByLabelText('Trả phòng')).toHaveValue('2026-11-05');
    await waitFor(() =>
      expect(within(sheet).getByTestId('quote-total')).toHaveTextContent(/36\.000\.000/),
    );
  });

  it('opens the booking sheet from a booked day', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    renderPage();
    await user.click(await cell(/^Thứ Sáu 06\/11, Đã đặt BK-0001/));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText(/BK-0001/)).toBeInTheDocument();
    expect(calls.some((c) => c.key === `GET /lodging/bookings/${BK1}`)).toBe(true);
  });

  it('lets a view-only member open bookings but not select nights', async () => {
    can.value = false;
    stubApi();
    const user = userEvent.setup();
    renderPage();
    await user.click(await cell(/^Thứ Hai 02\/11, trống/));
    await user.click(await cell(/^Thứ Tư 04\/11, trống/));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('status', { name: '' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Thứ Sáu 06\/11, Đã đặt BK-0001/ }));
    expect(await within(await screen.findByRole('dialog')).findByText(/BK-0001/)).toBeVisible();
  });

  it('steps by month and goes back to today', async () => {
    stubApi();
    const user = userEvent.setup();
    const onSearch = renderPage();
    await cell(/^Thứ Hai 02\/11, trống/);
    await user.click(screen.getByRole('button', { name: 'Sau' }));
    expect(onSearch).toHaveBeenLastCalledWith({ from: '2026-12-01' });
    expect(await screen.findByTestId('pcal-period')).toHaveTextContent('Tháng 12/2026');
    await user.click(screen.getByRole('button', { name: 'Hôm nay' }));
    expect(onSearch).toHaveBeenLastCalledWith({});
  });

  it('goes back to the month of today in the business time zone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 17:30 UTC on 30/11 is already 01/12 in Asia/Ho_Chi_Minh.
    vi.setSystemTime(new Date('2026-11-30T17:30:00.000Z'));
    const calls = stubApi();
    const user = userEvent.setup();
    const onSearch = renderPage(A17, { from: '2027-03-01' });
    expect(await screen.findByTestId('pcal-period')).toHaveTextContent('Tháng 03/2027');
    await user.click(screen.getByRole('button', { name: 'Hôm nay' }));
    expect(onSearch).toHaveBeenLastCalledWith({});
    expect(await screen.findByTestId('pcal-period')).toHaveTextContent('Tháng 12/2026');
    await waitFor(() =>
      expect(calls.map((c) => c.url)).toContain(
        `/lodging/calendar?from=2026-11-29&to=2027-01-04&propertyIds=${A17}`,
      ),
    );
  });

  it('splits a stay that crosses a week into one bar per week', async () => {
    extra.segments = [
      {
        ...segment,
        bookingId: BK2,
        code: 'BK-0009',
        status: 'confirmed',
        from: '2026-11-14',
        to: '2026-11-17',
        guestName: 'Chị Mai',
        holdExpiresAt: null,
        totalSell: 39_000_000,
      },
    ];
    stubApi();
    renderPage();
    await cell(/^Thứ Hai 02\/11, trống/);
    const bars = screen.getAllByText('Chị Mai · BK-0009').map((l) => l.parentElement);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveStyle({ gridColumn: '6 / 8' });
    expect(bars[1]).toHaveStyle({ gridColumn: '1 / 2' });
  });

  it('moves between days with the arrow keys', async () => {
    stubApi();
    const user = userEvent.setup();
    renderPage();
    (await cell(/^Thứ Hai 02\/11, trống/)).focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName(/^Thứ Ba 03\/11/);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName(/^Thứ Ba 10\/11/);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toHaveAccessibleName(/^Thứ Ba 27\/10/);
  });

  it('completes a drag with the nights dragged over, and forgets a cancelled drag', async () => {
    stubApi();
    renderPage();
    const day = (d: string) => cell(new RegExp(`^Thứ \\S+ ${d}\\/11, trống`));
    fireEvent.pointerDown(await day('09'), { button: 0 });
    fireEvent.pointerEnter(await day('10'));
    fireEvent.pointerEnter(await day('11'));
    fireEvent.pointerUp(window);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByLabelText('Nhận phòng')).toHaveValue('2026-11-09');
    expect(within(sheet).getByLabelText('Trả phòng')).toHaveValue('2026-11-12');
  });

  it('drops a drag the browser cancelled instead of completing it later', async () => {
    stubApi();
    const user = userEvent.setup();
    renderPage();
    const day = (d: string) => cell(new RegExp(`^Thứ \\S+ ${d}\\/11, trống`));
    fireEvent.pointerDown(await day('12'), { button: 0 });
    fireEvent.pointerEnter(await day('13'));
    fireEvent.pointerCancel(window);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    await user.click(await day('17'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('17/11');
  });

  it('keeps the grid inert while the next month loads', async () => {
    extra.hangFrom = '2026-11-29';
    stubApi();
    const user = userEvent.setup();
    renderPage();
    await cell(/^Thứ Hai 02\/11, trống/);
    await user.click(screen.getByRole('button', { name: 'Sau' }));
    const body = screen.getByTestId('pcal-body');
    expect(body).toHaveAttribute('aria-busy', 'true');
    // December days have no data yet: clicking them selects nothing.
    await user.click(screen.getByRole('button', { name: /^Thứ Tư 02\/12/, hidden: true }));
    await user.click(screen.getByRole('button', { name: /^Thứ Sáu 04\/12/, hidden: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Đã chọn nhận phòng/)).toBeNull();
    expect(screen.getByTestId('pcal-stats')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the range figures, next check-ins and waiting bot holds in the side panel', async () => {
    stubApi();
    renderPage();
    const panel = await screen.findByTestId('pcal-stats');
    // 2 of 30 November nights taken; the confirmed stay's total is booked revenue.
    await waitFor(() => expect(panel).toHaveTextContent('7%'));
    expect(panel).toHaveTextContent('26.000.000');
    const holds = within(panel).getAllByRole('button', { name: 'Mở BK-0001' });
    expect(holds.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PropertyCalendarPage — other views', () => {
  it('switches the view through the search and asks for the wider window', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    const onSearch = renderPage();
    await cell(/^Thứ Hai 02\/11, trống/);
    await user.click(screen.getByRole('radio', { name: '3 tháng' }));
    expect(onSearch).toHaveBeenLastCalledWith({ view: 'quarter', from: '2026-11-01' });
    expect(await screen.findByTestId('pcal-quarter')).toBeInTheDocument();
    expect(calls.map((c) => c.url)).toContain(
      `/lodging/calendar?from=2026-10-31&to=2027-02-01&propertyIds=${A17}`,
    );
    expect(screen.getByTestId('pcal-period')).toHaveTextContent('11/2026 – 01/2027');
    expect(
      screen.getByRole('button', { name: 'Thứ Sáu 06/11, Đã đặt BK-0001. Mở booking' }),
    ).toBeInTheDocument();
    // A booked day opens its booking; a free one opens its month.
    await user.click(screen.getByRole('button', { name: /^Thứ Hai 07\/12, Trống/ }));
    expect(onSearch).toHaveBeenLastCalledWith({ from: '2026-12-01' });
  });

  it('shows the occupancy of each month of the year and opens a month', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    const onSearch = renderPage(A17, { view: 'year', from: '2026-11-01' });
    const november = await screen.findByRole('button', { name: 'Mở tháng 11/2026, lấp đầy 7%' });
    expect(november).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Mở tháng 10/2027, lấp đầy 0%' }),
    ).toBeInTheDocument();
    expect(calls.map((c) => c.url)).toContain(
      `/lodging/calendar?from=2026-10-31&to=2027-11-01&propertyIds=${A17}`,
    );
    await user.click(screen.getByRole('button', { name: /^Mở tháng 02\/2027/ }));
    expect(onSearch).toHaveBeenLastCalledWith({ from: '2027-02-01' });
    expect(await screen.findByTestId('pcal-month')).toBeInTheDocument();
    expect(screen.getByTestId('pcal-period')).toHaveTextContent('Tháng 02/2027');
  });

  it('lists the bookings with the bot badge, phone and conversation link', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    renderPage(A17, { view: 'list' });
    const list = await screen.findByTestId('pcal-list');
    const row = await within(list).findByText('Anh Nam');
    const line = row.closest('li');
    if (!line) throw new Error('no booking line');
    expect(within(line).getByText('Bot tạo')).toBeInTheDocument();
    expect(within(line).getByText('Gói 5PN')).toBeInTheDocument();
    expect(within(line).getByRole('link', { name: 'Gọi 0912345678' })).toHaveAttribute(
      'href',
      'tel:0912345678',
    );
    expect(within(line).getByRole('link', { name: 'Mở hội thoại' })).toHaveAttribute(
      'href',
      `/app/inbox?conversation=${CONV}`,
    );
    expect(calls.map((c) => c.url)).toContain(`/lodging/bookings?view=upcoming&propertyId=${A17}`);
    await user.click(within(line).getByRole('button', { name: 'BK-0001' }));
    expect(await within(await screen.findByRole('dialog')).findByText(/BK-0001/)).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('radio', { name: 'Đã qua' }));
    await waitFor(() =>
      expect(calls.map((c) => c.url)).toContain(`/lodging/bookings?view=past&propertyId=${A17}`),
    );
  });
});

describe('PropertyCalendarPage — rooms', () => {
  it('restarts the selection when another room is picked', async () => {
    stubApi();
    const user = userEvent.setup();
    const onSearch = renderPage(H1, { from: '2026-11-01', unit: R1 });
    await user.click(await cell(/^Thứ Ba 10\/11, trống/));
    expect(screen.getByText(/Đã chọn nhận phòng 10\/11/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'P102' }));
    expect(onSearch).toHaveBeenLastCalledWith({ from: '2026-11-01', unit: R2 });
    await waitFor(() => expect(screen.queryByText(/Đã chọn nhận phòng/)).toBeNull());
    expect(await cell(/^Thứ Ba 10\/11, trống/)).toHaveAttribute('aria-pressed', 'false');
    await user.click(await cell(/^Thứ Năm 12\/11, trống/));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/Đã chọn nhận phòng 12\/11/)).toBeInTheDocument();
  });

  it('selects whole-place nights on "Cả căn" and never a partly booked day', async () => {
    const calls = stubApi({
      [`GET /lodging/properties/${H1}`]: {
        status: 200,
        body: { ...property, id: H1, code: 'H1', sellMode: 'rooms', units: [] },
      },
    });
    const user = userEvent.setup();
    renderPage(H1);
    await screen.findByRole('radio', { name: 'Cả căn' });
    expect(screen.queryByRole('button', { name: /Thứ Ba 03\/11/ })).toBeNull();
    await user.click(await cell(/^Thứ Hai 09\/11, trống/));
    await user.click(await cell(/^Thứ Ba 10\/11, trống/));
    await screen.findByRole('dialog');
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /lodging/quote')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /lodging/quote')?.body).toMatchObject({
      propertyId: H1,
      whole: true,
      unitIds: [],
      checkIn: '2026-11-09',
      checkOut: '2026-11-11',
    });
  });

  it('drops a unit that is not a room of the property from the URL', async () => {
    stubApi();
    const onSearch = renderPage(H1, { from: '2026-11-01', unit: A17_UNIT });
    await screen.findByRole('radio', { name: 'Cả căn' });
    await waitFor(() =>
      expect(onSearch).toHaveBeenCalledWith({ from: '2026-11-01' }, { replace: true }),
    );
    expect(screen.getByRole('radio', { name: 'Cả căn' })).toBeChecked();
  });

  it('shows free rooms per day for the whole place and one room’s bookings when picked', async () => {
    stubApi();
    const user = userEvent.setup();
    const onSearch = renderPage(H1);
    const whole = await screen.findByRole('radio', { name: 'Cả căn' });
    expect(whole).toBeChecked();
    expect(screen.getByText('Thứ Ba 03/11, còn 1/2 phòng')).toBeInTheDocument();
    expect(screen.queryByText('Chị Lan · BK-0002')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'P101' }));
    expect(onSearch).toHaveBeenLastCalledWith({ from: '2026-11-01', unit: R1 });
    expect(await screen.findByText('Chị Lan · BK-0002')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'P101' })).toBeChecked();
  });

  it('selects nights of one room for a room booking', async () => {
    stubApi({
      [`GET /lodging/properties/${H1}`]: {
        status: 200,
        body: { ...property, id: H1, code: 'H1', sellMode: 'rooms', units: [] },
      },
    });
    const user = userEvent.setup();
    renderPage(H1, { from: '2026-11-01', unit: R2 });
    await user.click(await cell(/^Thứ Hai 09\/11, trống/));
    await user.click(await cell(/^Thứ Ba 10\/11, trống/));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByLabelText('Nhận phòng')).toHaveValue('2026-11-09');
    expect(within(sheet).getByLabelText('Trả phòng')).toHaveValue('2026-11-11');
  });
});
