import type { CalendarDto, PropertyDto, QuoteDto } from '@agent-sales/contracts';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithRouter } from '@/testing/render';

import { CalendarPage } from './calendar-page';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// The grid renders hundreds of named cell buttons; its first render plus the accessible-name
// scan of a role query takes ~0.6–1.2 s on a cold worker, so the default 1 s `findBy` timeout
// flaked under load (e.g. inside `pnpm check`). Same assertions, a longer wait.
configure({ asyncUtilTimeout: 5000 });
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
afterEach(() => {
  can.value = true;
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
const NOTE1 = '0193a000-0000-7000-8000-000000000301';
const NOTE2 = '0193a000-0000-7000-8000-000000000302';
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
              guestPhone: '0912345678',
              party: { adults: 20, childAges: [5] },
              totalSell: 26_000_000,
              tags: ['Đã cọc', 'Khách quen'],
              note: 'Khách đến muộn khoảng 22h, cần để đèn cổng',
            },
          ],
        },
      ],
      internalNote: 'Chủ nhà: gọi trước 21h, chìa khoá ở bảo vệ',
      notes: [{ id: NOTE1, unitId: null, night: '2026-11-03', text: 'Sửa điện chiều' }],
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
              guestPhone: '',
              party: { adults: 2, childAges: [] },
              totalSell: 600_000,
              tags: [],
              note: '',
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
      internalNote: '',
      notes: [],
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
  tags: [],
  blockReason: '',
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  history: [],
};

/** BK-0001 as the booking sheet loads it (A17, nights 06/11 and 07/11). */
const bookedA17 = {
  ...created,
  code: 'BK-0001',
  status: 'confirmed',
  checkIn: '2026-11-06',
  checkOut: '2026-11-08',
  guestName: 'Anh Nam',
  holdExpiresAt: null,
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
    const bar = screen.getByText('Anh Nam · BK-0001');
    // Guest and code first; the status word follows (shown when the bar is wide enough).
    expect(bar.nextElementSibling).toHaveTextContent('Đã đặt');
    expect(bar.nextElementSibling).toHaveClass('hidden', '@min-[10rem]:inline');
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

  it('keeps the expiring-soon cue on a short hold bar and the guest label readable', async () => {
    const soon = structuredClone(calendar);
    const seg = soon.properties[1]?.rows[0]?.segments[0];
    if (seg) seg.holdExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    stubApi({ 'GET /lodging/calendar': { status: 200, body: soon } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Xem từng phòng của H1/ }));
    const label = screen.getByText('Chị Lan · BK-0002');
    expect(label).toHaveClass('min-w-[min(6rem,100%)]');
    const bar = label.parentElement;
    expect(bar).toHaveClass('border-destructive');
    expect(bar?.querySelector('svg')).toHaveClass('text-destructive');
    // The status text gives way first.
    expect(label.nextElementSibling).toHaveClass('shrink-[999]');
  });

  it('lets a view-only member open bookings but not select nights or hold', async () => {
    can.value = false;
    const calls = stubApi({
      [`GET /lodging/bookings/${BK1}`]: { status: 200, body: created },
      'POST /lodging/availability': {
        status: 200,
        body: {
          options: [{ propertyId: A17, whole: true, unitIds: [A17_UNIT], fits: true, quote }],
        },
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await cell(/^A17, Thứ Hai 02\/11, trống/));
    await user.click(await cell(/^A17, Thứ Tư 04\/11, trống/));
    expect(screen.queryByRole('dialog')).toBeNull();
    const find = screen.getByRole('search');
    await user.type(within(find).getByLabelText('Nhận phòng'), '2026-11-09');
    await user.type(within(find).getByLabelText('Trả phòng'), '2026-11-11');
    await user.click(within(find).getByRole('button', { name: 'Tìm' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /lodging/availability')).toBe(true),
    );
    expect(screen.queryByRole('button', { name: /Giữ chỗ ·/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^A17, Thứ Sáu 06\/11, Đã đặt BK-0001/ }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText(/BK-/)).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Sửa' })).toBeNull();
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

  it('on a phone shows month cards whose full nights open the booking', async () => {
    const width = window.innerWidth;
    window.innerWidth = 375;
    try {
      const calls = stubApi({ [`GET /lodging/bookings/${BK1}`]: { status: 200, body: created } });
      const user = userEvent.setup();
      renderPage();
      const full = await screen.findByRole('button', { name: 'A17 06/11: Đã kín' });
      expect(screen.queryByRole('radio', { name: 'Tháng' })).toBeNull();
      expect(calls.map((c) => c.url)).toContain('/lodging/calendar?from=2026-11-02&to=2026-12-03');
      await user.click(full);
      expect(
        await within(await screen.findByRole('dialog')).findByText('BK-0003'),
      ).toBeInTheDocument();
      expect(calls.some((c) => c.key === `GET /lodging/bookings/${BK1}`)).toBe(true);
    } finally {
      window.innerWidth = width;
    }
  });
});

describe('CalendarPage notes, tags and quick view', () => {
  it('marks a night with a note and shows the note on hover', async () => {
    stubApi();
    const user = userEvent.setup();
    renderPage();
    const tuesday = await cell(/^A17, Thứ Ba 03\/11, trống, .*, có ghi chú: Sửa điện chiều$/);
    expect(tuesday.querySelector('[data-note-dot]')).not.toBeNull();
    const monday = screen.getByRole('button', { name: /^A17, Thứ Hai 02\/11, trống/ });
    expect(monday.querySelector('[data-note-dot]')).toBeNull();
    await user.hover(tuesday);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sửa điện chiều');
  });

  it('saves a night note for every selected night from the Ghi chú tab', async () => {
    const calls = stubApi({
      [`PUT /lodging/properties/${A17}/notes`]: {
        status: 200,
        body: { note: { id: NOTE1, unitId: null, night: '2026-11-02', text: 'Khoá cổng' } },
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await cell(/^A17, Thứ Hai 02\/11, trống/));
    await user.click(await cell(/^A17, Thứ Tư 04\/11, trống/));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('tab', { name: 'Ghi chú' }));
    expect(within(sheet).queryByLabelText('Tên khách')).toBeNull();
    const text = within(sheet).getByRole('textbox', { name: 'Ghi chú cho đêm đã chọn' });
    await user.type(text, 'Khoá cổng');
    await user.click(within(sheet).getByRole('button', { name: 'Lưu ghi chú' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === `PUT /lodging/properties/${A17}/notes`)).toHaveLength(3),
    );
    const bodies = calls
      .filter((c) => c.key === `PUT /lodging/properties/${A17}/notes`)
      .map((c) => c.body);
    expect(bodies).toEqual([
      { unitId: null, night: '2026-11-02', text: 'Khoá cổng' },
      { unitId: null, night: '2026-11-03', text: 'Khoá cổng' },
      { unitId: null, night: '2026-11-04', text: 'Khoá cổng' },
    ]);
    expect(calls.some((c) => c.key === 'POST /lodging/bookings')).toBe(false);
  });

  it('prefills the existing note and deletes it with an empty text', async () => {
    const calls = stubApi({
      [`PUT /lodging/properties/${A17}/notes`]: { status: 200, body: { note: null } },
    });
    const user = userEvent.setup();
    renderPage();
    const tuesday = await cell(/^A17, Thứ Ba 03\/11, trống/);
    await user.click(tuesday);
    await user.click(tuesday);
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('tab', { name: 'Ghi chú' }));
    expect(within(sheet).getByRole('textbox', { name: 'Ghi chú cho đêm đã chọn' })).toHaveValue(
      'Sửa điện chiều',
    );
    await user.click(within(sheet).getByRole('button', { name: 'Xoá ghi chú' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PUT /lodging/properties/${A17}/notes`)?.body).toEqual({
        unitId: null,
        night: '2026-11-03',
        text: '',
      }),
    );
  });

  it('shows a quick view of a booking on hover, with tag and note markers on its bar', async () => {
    stubApi();
    const user = userEvent.setup();
    renderPage();
    const taken = await cell(/^A17, Thứ Sáu 06\/11, Đã đặt BK-0001/);
    const label = screen.getByText('Anh Nam · BK-0001');
    const bar = label.parentElement;
    expect(bar?.querySelector('[data-marker="note"]')).not.toBeNull();
    expect(bar?.querySelector('[data-marker="tags"]')).toHaveTextContent('2');
    await user.hover(taken);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Anh Nam');
    expect(tip).toHaveTextContent('0912345678');
    expect(tip).toHaveTextContent('20 người lớn, 1 trẻ em');
    expect(tip).toHaveTextContent('26.000.000');
    expect(tip).toHaveTextContent('Đã cọc');
    expect(tip).toHaveTextContent('Khách quen');
    expect(tip).toHaveTextContent('Khách đến muộn');
  });

  it('opens the quick view from the keyboard too', async () => {
    stubApi();
    renderPage();
    const taken = await cell(/^A17, Thứ Sáu 06\/11, Đã đặt BK-0001/);
    taken.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Anh Nam');
  });

  it('announces the night note of a booked cell once (in its label, not in the tooltip)', async () => {
    const noted = structuredClone(calendar);
    noted.properties[0]?.notes.push({
      id: NOTE2,
      unitId: null,
      night: '2026-11-06',
      text: 'Dọn hồ bơi sáng',
    });
    stubApi({ 'GET /lodging/calendar': { status: 200, body: noted } });
    renderPage();
    const taken = await cell(/^A17, Thứ Sáu 06\/11, Đã đặt BK-0001, có ghi chú: Dọn hồ bơi sáng$/);
    taken.focus();
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Dọn hồ bơi sáng');
    expect(taken).toHaveAccessibleDescription(expect.stringContaining('Anh Nam'));
    expect(taken).not.toHaveAccessibleDescription(expect.stringContaining('Dọn hồ bơi sáng'));
  });

  it('opens the booking sheet on its night notes from the tooltip "Sửa ghi chú"', async () => {
    const noted = structuredClone(calendar);
    noted.properties[0]?.notes.push({
      id: NOTE2,
      unitId: null,
      night: '2026-11-07',
      text: 'Dọn hồ bơi sáng',
    });
    const calls = stubApi({
      'GET /lodging/calendar': { status: 200, body: noted },
      [`GET /lodging/bookings/${BK1}`]: { status: 200, body: bookedA17 },
      [`PUT /lodging/properties/${A17}/notes`]: {
        status: 200,
        body: { note: { id: NOTE2, unitId: null, night: '2026-11-07', text: 'Dọn hồ bơi chiều' } },
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.hover(await cell(/^A17, Thứ Bảy 07\/11, Đã đặt BK-0001/));
    const tip = await screen.findByRole('tooltip');
    const action = tip.querySelector<HTMLButtonElement>('[data-action="edit-night-note"]');
    expect(action).toHaveTextContent('Sửa ghi chú');
    await user.click(action as HTMLButtonElement);
    const sheet = await screen.findByRole('dialog');
    const section = await within(sheet).findByRole('region', { name: 'Ghi chú ngày' });
    const text = await within(section).findByRole('textbox', { name: 'Ghi chú cho đêm đã chọn' });
    await waitFor(() => expect(text).toHaveFocus());
    expect(text).toHaveValue('Dọn hồ bơi sáng');
    expect(within(section).getByRole('checkbox', { name: 'T7 07/11' })).toBeChecked();
    expect(within(section).getByRole('checkbox', { name: 'T6 06/11' })).not.toBeChecked();
    await user.clear(text);
    await user.type(text, 'Dọn hồ bơi chiều');
    await user.click(within(section).getByRole('button', { name: 'Lưu ghi chú' }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.key === `PUT /lodging/properties/${A17}/notes`).map((c) => c.body),
      ).toEqual([{ unitId: null, night: '2026-11-07', text: 'Dọn hồ bơi chiều' }]),
    );
  });

  it('edits from the tooltip only the note of the hovered room of a whole booking', async () => {
    const BK3 = '0193a000-0000-7000-8000-000000000103';
    const booked = structuredClone(calendar);
    const h1 = booked.properties[1]!;
    for (const row of h1.rows)
      row.segments.push({
        bookingId: BK3,
        code: 'BK-0009',
        kind: 'stay',
        status: 'confirmed',
        from: '2026-11-09',
        to: '2026-11-11',
        guestName: 'Anh Tú',
        blockReason: '',
        holdExpiresAt: null,
        guestPhone: '',
        party: { adults: 6, childAges: [] },
        totalSell: 2_400_000,
        tags: [],
        note: '',
      });
    h1.notes.push(
      { id: NOTE1, unitId: R1, night: '2026-11-09', text: 'Thay ga P101' },
      { id: NOTE2, unitId: R2, night: '2026-11-09', text: 'Sửa vòi P102' },
    );
    const calls = stubApi({
      'GET /lodging/calendar': { status: 200, body: booked },
      [`GET /lodging/bookings/${BK3}`]: {
        status: 200,
        body: {
          ...bookedA17,
          id: BK3,
          code: 'BK-0009',
          propertyId: H1,
          propertyCode: 'H1',
          propertyName: 'Homestay Hoa Sứ',
          unitIds: [R1, R2],
          unitNames: ['P101', 'P102'],
          checkIn: '2026-11-09',
          checkOut: '2026-11-11',
        },
      },
      [`PUT /lodging/properties/${H1}/notes`]: {
        status: 200,
        body: { note: { id: NOTE2, unitId: R2, night: '2026-11-09', text: 'Đã sửa vòi' } },
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Xem từng phòng của H1/ }));
    await user.hover(await cell(/^H1 P102, Thứ Hai 09\/11, Đã đặt BK-0009/));
    const tip = await screen.findByRole('tooltip');
    const action = tip.querySelector<HTMLButtonElement>('[data-action="edit-night-note"]');
    await user.click(action as HTMLButtonElement);
    const sheet = await screen.findByRole('dialog');
    const section = await within(sheet).findByRole('region', { name: 'Ghi chú ngày' });
    expect(await within(section).findByText('Thay ga P101')).toBeInTheDocument();
    const text = await within(section).findByRole('textbox', { name: 'Ghi chú cho đêm đã chọn' });
    await waitFor(() => expect(text).toHaveValue('Sửa vòi P102'));
    await user.clear(text);
    await user.type(text, 'Đã sửa vòi');
    await user.click(within(section).getByRole('button', { name: 'Lưu ghi chú' }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.key === `PUT /lodging/properties/${H1}/notes`).map((c) => c.body),
      ).toEqual([{ unitId: R2, night: '2026-11-09', text: 'Đã sửa vòi' }]),
    );
  });

  it('offers no "Sửa ghi chú" in the tooltip without orders.manage', async () => {
    can.value = false;
    stubApi();
    const user = userEvent.setup();
    renderPage();
    await user.hover(await cell(/^A17, Thứ Sáu 06\/11, Đã đặt BK-0001/));
    const tip = await screen.findByRole('tooltip');
    expect(tip.querySelector('[data-action="edit-night-note"]')).toBeNull();
  });

  it('describes the internal-note button with the note for screen readers', async () => {
    stubApi();
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Ghi chú nội bộ của A17' });
    expect(trigger).toHaveAccessibleDescription('Chủ nhà: gọi trước 21h, chìa khoá ở bảo vệ');
  });

  it('shows the property internal note in a card on the property name', async () => {
    stubApi();
    const user = userEvent.setup();
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Ghi chú nội bộ của A17' });
    expect(screen.queryByRole('button', { name: 'Ghi chú nội bộ của H1' })).toBeNull();
    await user.click(trigger);
    // The card shows the note; the other copy is the trigger's visually hidden description.
    await waitFor(() =>
      expect(screen.getAllByText('Chủ nhà: gọi trước 21h, chìa khoá ở bảo vệ')).toHaveLength(2),
    );
    expect(screen.getByText('Ghi chú nội bộ')).toBeInTheDocument();
  });
});
