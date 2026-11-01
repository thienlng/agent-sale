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
const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
afterEach(() => {
  can.value = true;
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

  it('asks a checked-in booking with a manual price which price applies when its check-out moves', async () => {
    const stayed = booking({ status: 'checked_in', holdExpiresAt: null, totalSell: 20_000_000 });
    const calls = stubApi({
      [`GET /lodging/bookings/${BK}`]: { status: 200, body: stayed },
      [`GET /lodging/properties/${PROP}`]: { status: 200, body: property },
      'POST /lodging/quote': { status: 200, body: quote },
      [`PATCH /lodging/bookings/${BK}`]: { status: 200, body: stayed },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Sửa' }));
    expect(within(sheet).getByLabelText('Nhận phòng')).toBeDisabled();
    expect(within(sheet).queryByLabelText('Giá thủ công')).toBeNull();
    const out = within(sheet).getByLabelText('Trả phòng');
    await user.clear(out);
    await user.type(out, '2099-11-06');
    expect(within(sheet).getByText(/Nhập giá thủ công mới/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
    const manual = within(sheet).getByLabelText('Giá nhập tay (tiền phòng)');
    await user.clear(manual);
    await user.type(manual, '30000000');
    await user.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({
        version: 3,
        checkOut: '2099-11-06',
        manualTotalSell: 30_000_000,
      }),
    );
  });

  it('an adjustment-only edit shows the stored total plus the new adjustment and sends no price', async () => {
    const manual = booking({ totalSell: 20_000_000, status: 'confirmed', holdExpiresAt: null });
    const calls = stubApi({
      [`GET /lodging/bookings/${BK}`]: { status: 200, body: manual },
      [`GET /lodging/properties/${PROP}`]: { status: 200, body: property },
      [`PATCH /lodging/bookings/${BK}`]: { status: 200, body: manual },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Sửa' }));
    const adjustment = within(sheet).getByLabelText('Điều chỉnh (+/−)');
    await user.clear(adjustment);
    await user.type(adjustment, '-1000000');
    await waitFor(() =>
      expect(within(sheet).getByTestId('quote-total')).toHaveTextContent(/19\.000\.000/),
    );
    await user.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({
        version: 3,
        adjustment: -1_000_000,
      }),
    );
    expect(calls.some((c) => c.key === 'POST /lodging/quote')).toBe(false);
  });

  it('treats re-picked rooms in another order as the same rooms', async () => {
    const R1 = '0193a000-0000-7000-8000-000000000021';
    const R2 = '0193a000-0000-7000-8000-000000000022';
    const room = (id: string, name: string, sortOrder: number) => ({
      id,
      kind: 'room',
      name,
      beds: '',
      capacityAdults: 2,
      capacityChildren: 0,
      active: true,
      sortOrder,
    });
    const homestay = {
      ...property,
      area: '',
      address: '',
      description: '',
      sellMode: 'rooms',
      status: 'active',
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
      units: [room(R1, 'P101', 0), room(R2, 'P102', 1)],
      rates: [],
      surcharges: { extraAdult: null, extraChild: null },
      version: 1,
      createdAt: '2099-10-30T00:00:00.000Z',
      updatedAt: '2099-10-30T00:00:00.000Z',
    } as unknown as PropertyDto;
    const manual = booking({
      whole: false,
      unitIds: [R1, R2],
      unitNames: ['P101', 'P102'],
      totalSell: 20_000_000,
    });
    const calls = stubApi({
      [`GET /lodging/bookings/${BK}`]: { status: 200, body: manual },
      [`GET /lodging/properties/${PROP}`]: { status: 200, body: homestay },
      [`PATCH /lodging/bookings/${BK}`]: { status: 200, body: manual },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Sửa' }));
    const p101 = await within(sheet).findByRole('button', { name: 'P101' });
    await user.click(p101);
    await user.click(p101); // now [R2, R1]
    expect(within(sheet).queryByText(/Nhập giá thủ công mới/)).toBeNull();
    await user.type(within(sheet).getByLabelText('Ghi chú'), 'Tầng 2');
    await user.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({
        version: 3,
        note: 'Tầng 2',
      }),
    );
    expect(calls.some((c) => c.key === 'POST /lodging/quote')).toBe(false);
  });

  it('lets a view-only member read a booking without actions or editing', async () => {
    can.value = false;
    stubApi({ [`GET /lodging/bookings/${BK}`]: { status: 200, body: booking() } });
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('Anh Nam')).toBeInTheDocument();
    for (const name of ['Xác nhận', 'Gia hạn giữ', 'Huỷ', 'Sửa'])
      expect(within(sheet).queryByRole('button', { name })).toBeNull();
  });

  it('says the hold expired when a status move comes too late', async () => {
    stubApi({
      [`GET /lodging/bookings/${BK}`]: { status: 200, body: booking() },
      [`POST /lodging/bookings/${BK}/status`]: {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'The hold has expired',
            details: { reason: 'HOLD_EXPIRED' },
          },
        },
      },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Xác nhận' }));
    expect(await within(sheet).findByText(/Giữ chỗ đã hết hạn/)).toBeInTheDocument();
  });

  it('opens the cancel dialog without the error of an earlier action', async () => {
    stubApi({
      [`GET /lodging/bookings/${BK}`]: { status: 200, body: booking() },
      [`POST /lodging/bookings/${BK}/status`]: {
        status: 409,
        body: {
          error: { code: 'CONFLICT', message: 'stale', details: { reason: 'STALE_VERSION' } },
        },
      },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Xác nhận' }));
    expect(await within(sheet).findByText(/vừa được người khác cập nhật/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Huỷ' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).queryByText(/vừa được người khác cập nhật/)).toBeNull();
  });

  it('shows a failed cancel inside the dialog and reloads on a stale version', async () => {
    const calls = stubApi({
      [`GET /lodging/bookings/${BK}`]: {
        status: 200,
        body: booking({ status: 'confirmed', holdExpiresAt: null }),
      },
      [`POST /lodging/bookings/${BK}/status`]: {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'stale',
            details: { reason: 'STALE_VERSION', version: 4 },
          },
        },
      },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Huỷ' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.type(within(confirm).getByLabelText('Lý do huỷ'), 'Khách đổi lịch');
    await user.click(within(confirm).getByRole('button', { name: 'Huỷ' }));
    expect(await within(confirm).findByText(/vừa được người khác cập nhật/)).toBeInTheDocument();
    const loads = calls.filter((c) => c.key === `GET /lodging/bookings/${BK}`).length;
    await user.click(within(confirm).getByRole('button', { name: 'Tải lại' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === `GET /lodging/bookings/${BK}`).length).toBeGreaterThan(
        loads,
      ),
    );
    await waitFor(() =>
      expect(within(confirm).queryByText(/vừa được người khác cập nhật/)).toBeNull(),
    );
  });

  it('says the guest name is required when it is cleared in edit mode', async () => {
    stubApi({
      [`GET /lodging/bookings/${BK}`]: { status: 200, body: booking() },
      [`GET /lodging/properties/${PROP}`]: { status: 200, body: property },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Sửa' }));
    await user.clear(within(sheet).getByLabelText('Tên khách'));
    await user.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    expect(within(sheet).getByText('Bắt buộc')).toBeInTheDocument();
  });
});

describe('BookingSheet create', () => {
  it('accepts a negative adjustment typed with its sign', async () => {
    const calls = stubApi({
      'GET /lodging/properties': { status: 200, body: { data: [] } },
      [`GET /lodging/properties/${PROP}`]: { status: 200, body: property },
      'POST /lodging/quote': { status: 200, body: quote },
      'POST /lodging/bookings': { status: 201, body: booking() },
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
    const adj = within(sheet).getByLabelText('Điều chỉnh (+/−)');
    await user.type(adj, '-');
    expect(adj).toHaveValue('-');
    await user.type(adj, '500000');
    expect(adj).toHaveValue('-500000');
    await waitFor(() =>
      expect(within(sheet).getByTestId('quote-total')).toHaveTextContent(/23\.500\.000/),
    );
    await user.click(within(sheet).getByRole('button', { name: 'Giữ chỗ' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /lodging/bookings')?.body).toMatchObject({
        adjustment: -500_000,
      }),
    );
  });
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
