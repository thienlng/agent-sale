import type { BookingDetail, PropertyDto } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithRouter } from '@/testing/render';

import { BookingSheet, type BookingSheetProps } from './booking-sheet';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PROP = '0193a000-0000-7000-8000-000000000001';
const UNIT = '0193a000-0000-7000-8000-000000000011';
const BK = '0193a000-0000-7000-8000-000000000101';
const CONV = '0193a000-0000-7000-8000-000000000201';

const quote = {
  nights: [
    { date: '2099-11-02', weekday: 1, label: '', sell: 12_000_000, cost: 10_000_000 },
    { date: '2099-11-03', weekday: 2, label: '', sell: 12_000_000, cost: 10_000_000 },
  ],
  surcharges: [],
  totalSell: 24_000_000,
  totalCost: 20_000_000,
  warnings: [],
  takenBy: [],
};
const booking = (over: Partial<BookingDetail> = {}): BookingDetail => ({
  id: BK,
  code: 'BK-0007',
  propertyId: PROP,
  propertyCode: 'A17',
  propertyName: 'Villa A17',
  kind: 'stay',
  whole: true,
  unitIds: [UNIT],
  unitNames: ['Nguyên căn'],
  status: 'hold',
  checkIn: '2099-11-02',
  checkOut: '2099-11-04',
  party: { adults: 10, childAges: [] },
  guestName: 'Anh Nam',
  guestPhone: '0912345678',
  contactId: null,
  conversationId: CONV,
  source: 'messenger',
  holdExpiresAt: '2099-11-01T07:30:00.000Z',
  quote,
  adjustment: 0,
  adjustmentReason: '',
  totalSell: 24_000_000,
  totalCost: 20_000_000,
  note: '',
  blockReason: '',
  version: 3,
  createdAt: '2099-10-30T00:00:00.000Z',
  updatedAt: '2099-10-30T00:00:00.000Z',
  history: [
    {
      at: '2099-10-30T00:00:00.000Z',
      actorName: 'Ngọc Anh',
      action: 'lodging.booking.created',
      data: {},
    },
  ],
  ...over,
});
const property = {
  id: PROP,
  code: 'A17',
  name: 'Villa A17',
  sellMode: 'whole',
  standardAdults: 24,
  standardChildren: 8,
  units: [
    {
      id: UNIT,
      kind: 'whole',
      name: 'Nguyên căn',
      beds: '',
      capacityAdults: 24,
      capacityChildren: 8,
      active: true,
      sortOrder: 0,
    },
  ],
} as unknown as PropertyDto;

type Reply = { status: number; body?: unknown };
function stubApi(routes: Record<string, Reply>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${input.replace('/api/v1', '').split('?')[0]}`;
    calls.push({ key, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

function renderSheet(props: Partial<BookingSheetProps> & Pick<BookingSheetProps, 'mode'>) {
  const all = { open: true, onOpenChange: () => {}, ...props } as BookingSheetProps;
  renderWithRouter(() => (
    <TooltipProvider>
      <BookingSheet {...all} />
    </TooltipProvider>
  ));
}

describe('BookingSheet view', () => {
  it('offers the hold actions and confirms with the current version', async () => {
    const calls = stubApi({
      [`GET /lodging/bookings/${BK}`]: { status: 200, body: booking() },
      [`POST /lodging/bookings/${BK}/status`]: {
        status: 200,
        body: booking({ status: 'confirmed', version: 4 }),
      },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('BK-0007')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Gia hạn giữ' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /Mở hội thoại/ })).toHaveAttribute(
      'href',
      `/app/inbox?conversation=${CONV}`,
    );
    expect(within(sheet).getByText('Ngọc Anh')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.endsWith('/status'))?.body).toMatchObject({
        action: 'confirm',
        version: 3,
      }),
    );
  });

  it('disables check-in before the check-in date and asks a reason to cancel', async () => {
    const calls = stubApi({
      [`GET /lodging/bookings/${BK}`]: {
        status: 200,
        body: booking({ status: 'confirmed', holdExpiresAt: null }),
      },
      [`POST /lodging/bookings/${BK}/status`]: {
        status: 200,
        body: booking({ status: 'cancelled' }),
      },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByRole('button', { name: 'Nhận phòng' })).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: 'Huỷ' }));
    const confirm = await screen.findByRole('alertdialog');
    const go = within(confirm).getByRole('button', { name: 'Huỷ' });
    expect(go).toBeDisabled();
    await user.type(within(confirm).getByLabelText('Lý do huỷ'), 'Khách đổi lịch');
    await user.click(go);
    await waitFor(() =>
      expect(calls.find((c) => c.key.endsWith('/status'))?.body).toMatchObject({
        action: 'cancel',
        reason: 'Khách đổi lịch',
        version: 3,
      }),
    );
  });

  it('requires a new manual price or the calculated one when the dates of a manual-price booking change', async () => {
    const manual = booking({ totalSell: 20_000_000 }); // quote says 24tr → staff typed 20tr
    const calls = stubApi({
      [`GET /lodging/bookings/${BK}`]: { status: 200, body: manual },
      [`GET /lodging/properties/${PROP}`]: { status: 200, body: property },
      'POST /lodging/quote': { status: 200, body: { ...quote, totalSell: 36_000_000 } },
      [`PATCH /lodging/bookings/${BK}`]: { status: 200, body: manual },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Sửa' }));
    const out = within(sheet).getByLabelText('Trả phòng');
    await user.clear(out);
    await user.type(out, '2099-11-05');
    expect(
      within(sheet).getByText(/Nhập giá thủ công mới hoặc chọn dùng giá tính tự động/),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
    await user.click(within(sheet).getByRole('checkbox', { name: 'Dùng giá tính tự động' }));
    await user.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({
        version: 3,
        checkOut: '2099-11-05',
        party: { adults: 10, childAges: [] },
        manualTotalSell: null,
      }),
    );
  });
});

describe('BookingSheet create', () => {
  it('explains a lost race even when the server names no booking', async () => {
    stubApi({
      'GET /lodging/properties': { status: 200, body: { data: [] } },
      [`GET /lodging/properties/${PROP}`]: { status: 200, body: property },
      'POST /lodging/quote': { status: 200, body: quote },
      'POST /lodging/bookings': {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'taken',
            details: { reason: 'NIGHTS_TAKEN', codes: [] },
          },
        },
      },
    });
    const user = userEvent.setup();
    renderSheet({
      mode: 'create',
      initial: {
        propertyId: PROP,
        checkIn: '2099-11-02',
        checkOut: '2099-11-04',
        guestName: 'Chị Lan',
      },
    });
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Giữ chỗ' }));
    expect(
      await within(sheet).findByText('Một số đêm vừa có người đặt. Tải lại lịch để xem.'),
    ).toBeInTheDocument();
  });

  it('creates a block with its reason and no guest fields', async () => {
    const calls = stubApi({
      'GET /lodging/properties': { status: 200, body: { data: [] } },
      [`GET /lodging/properties/${PROP}`]: { status: 200, body: property },
      'POST /lodging/quote': { status: 200, body: quote },
      'POST /lodging/bookings': { status: 201, body: booking({ kind: 'block', status: 'active' }) },
    });
    const user = userEvent.setup();
    renderSheet({
      mode: 'create',
      initial: { propertyId: PROP, checkIn: '2099-11-02', checkOut: '2099-11-04' },
    });
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('tab', { name: 'Khoá lịch' }));
    expect(within(sheet).queryByLabelText('Tên khách')).toBeNull();
    await user.type(within(sheet).getByRole('textbox', { name: 'Lý do khoá' }), 'Sửa hồ bơi');
    await user.click(within(sheet).getByRole('button', { name: 'Khoá lịch' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /lodging/bookings')?.body).toMatchObject({
        kind: 'block',
        blockReason: 'Sửa hồ bơi',
        propertyId: PROP,
        whole: true,
        checkIn: '2099-11-02',
        checkOut: '2099-11-04',
      }),
    );
  });
});
