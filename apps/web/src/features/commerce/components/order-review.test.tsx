import type { OrderDto, OrderSummaryDto } from '@agent-sales/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { formatDateTime } from '@/lib/format';
import { renderWithProviders, renderWithRouter, stubFetch } from '@/testing/render';

import { APPROVE_UNDO_MS } from '../hooks/use-approve-order';
import { OrderReviewBanner } from './order-review-banner';
import { OrdersList } from './orders-list';
import { toOrderQuery } from './orders-search';
import { OrdersToolbar } from './orders-toolbar';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  toast.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

const BOT_ORDER = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const STAFF_ORDER = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e60';
const CONVERSATION = '4f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const amounts = {
  itemQty: 1,
  subtotal: 100_000,
  discountType: 'amount' as const,
  discountValue: 0,
  discountAmount: 0,
  afterDiscount: 100_000,
  shippingFee: 0,
  shippingFeeCharged: 0,
  freeShipping: false,
  surcharge: 0,
  gross: 100_000,
  total: 100_000,
  transferAmount: 0,
  paid: 0,
  remaining: 100_000,
  cod: 100_000,
};
const summary = (over: Partial<OrderSummaryDto>): OrderSummaryDto => ({
  id: BOT_ORDER,
  code: 'DH0001',
  status: 'new',
  source: 'facebook',
  customer: { name: 'Lan', phone: '0912345678' },
  recipient: { name: 'Lan', phone: '0912345678', address: '12 Lý Thường Kiệt' },
  carrier: null,
  trackingCode: null,
  noteInternal: '',
  amounts,
  itemsPreview: [
    { name: 'Tháp cầu vồng', qty: 1, variantName: null, unitPrice: 100_000, imageUrl: null },
  ],
  createdByName: null,
  createdByKind: 'bot',
  reviewState: 'pending',
  reviewedByName: null,
  reviewedAt: null,
  conversationId: CONVERSATION,
  placedAt: '2026-10-31T08:00:00.000Z',
  ...over,
});
const botPending = summary({});
const staffOrder = summary({
  id: STAFF_ORDER,
  code: 'DH0002',
  createdByKind: 'agent',
  createdByName: 'Ngọc Anh',
  reviewState: null,
  conversationId: null,
});
const detail = (over: Partial<OrderDto>): OrderDto => ({
  ...botPending,
  warehouseId: '5f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
  warehouseName: 'Kho chính',
  expectedDeliveryAt: null,
  notePrint: '',
  items: [],
  history: [],
  stockState: 'reserved',
  createdAt: '2026-10-31T08:00:00.000Z',
  updatedAt: '2026-10-31T08:00:00.000Z',
  ...over,
});
const approved = detail({
  reviewState: 'approved',
  reviewedByName: 'Thu Hà',
  reviewedAt: '2026-10-31T09:15:00.000Z',
});

const listBody = (rows: OrderSummaryDto[]) => ({
  data: rows,
  total: rows.length,
  page: 1,
  pageSize: 20,
  counts: { all: rows.length },
  totals: { itemQty: rows.length, shippingFeeCharged: 0, cod: 0, gross: 0, total: 0 },
  facets: { creators: [], carriers: [] },
});
const common = {
  'GET /order-settings': {
    status: 200,
    body: { extraStatuses: [], requireNoteStatuses: [], policies: [], version: 0 },
  },
  'GET /orders/review-count': { status: 200, body: { pending: 3 } },
  [`POST /orders/${BOT_ORDER}/approve`]: { status: 200, body: approved },
};

/** Lets the approve call hang until the test releases it, to see the optimistic row. */
function holdApprove(fetchStub: ReturnType<typeof stubFetch>['fetchStub']) {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const held = async (input: string, init: RequestInit = {}) => {
    if (input.endsWith('/approve')) await gate;
    return fetchStub(input, init);
  };
  return { held, release: () => release() };
}

describe('approving a bot order from the list', () => {
  it('approves optimistically, toasts with undo, and undo sends approve:false', async () => {
    const stub = stubFetch({
      ...common,
      'GET /orders?page=1&pageSize=20': { status: 200, body: listBody([botPending, staffOrder]) },
    });
    const { held, release } = holdApprove(stub.fetchStub);
    vi.stubGlobal('fetch', held);
    const user = userEvent.setup();
    renderWithRouter(() => (
      <TooltipProvider>
        <OrdersList search={{}} onSearch={() => {}} />
      </TooltipProvider>
    ));

    // The staff order has no "Duyệt đơn".
    await user.click(await screen.findByRole('button', { name: 'Thao tác với đơn DH0002' }));
    expect(await screen.findByRole('menuitem', { name: 'Xem chi tiết' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Duyệt đơn' })).toBeNull();
    await user.keyboard('{Escape}');

    expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thao tác với đơn DH0001' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duyệt đơn' }));

    // Optimistic: the row reads "Đã duyệt" before the server answers.
    expect(await screen.findByText('Đã duyệt')).toBeInTheDocument();
    expect(screen.queryByText('Chờ duyệt')).toBeNull();
    release();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const approve = stub.calls.filter((c) => c.key === `POST /orders/${BOT_ORDER}/approve`);
    expect(approve.map((c) => c.body)).toEqual([{ approve: true }]);
    const [message, options] = toast.success.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe('Đã duyệt đơn DH0001');
    expect(options.duration).toBe(APPROVE_UNDO_MS);
    expect(options.action.label).toBe('Hoàn tác');

    options.action.onClick();
    await waitFor(() =>
      expect(
        stub.calls.filter((c) => c.key === `POST /orders/${BOT_ORDER}/approve`).map((c) => c.body),
      ).toEqual([{ approve: true }, { approve: false }]),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Đã hoàn tác duyệt đơn DH0001'));
  });

  it('does not undo once the 5 s window has passed', async () => {
    const stub = stubFetch({
      ...common,
      'GET /orders?page=1&pageSize=20': { status: 200, body: listBody([botPending]) },
    });
    vi.stubGlobal('fetch', stub.fetchStub);
    const user = userEvent.setup();
    renderWithRouter(() => (
      <TooltipProvider>
        <OrdersList search={{}} onSearch={() => {}} />
      </TooltipProvider>
    ));
    await user.click(await screen.findByRole('button', { name: 'Thao tác với đơn DH0001' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duyệt đơn' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const options = toast.success.mock.calls[0]![1] as { action: { onClick: () => void } };

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + APPROVE_UNDO_MS + 1);
    options.action.onClick();
    await new Promise((r) => setTimeout(r, 50));
    expect(stub.calls.filter((c) => c.key.endsWith('/approve'))).toHaveLength(1);
  });
});

describe('"Bot · chờ duyệt" quick filter', () => {
  const toolbar = (review: 'pending' | undefined, onChange = vi.fn()) => (
    <OrdersToolbar
      search={{ review }}
      onChange={onChange}
      statuses={[]}
      counts={{}}
      facets={undefined}
      onExport={() => {}}
      exporting={false}
    />
  );

  it('shows the pending count and toggles review=pending', async () => {
    vi.stubGlobal('fetch', stubFetch(common).fetchStub);
    const onChange = vi.fn();
    const user = userEvent.setup();
    const view = renderWithProviders(toolbar(undefined, onChange));
    const chip = await screen.findByRole('button', {
      name: /Bot · chờ duyệt.*3 đơn bot chờ duyệt/,
    });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(onChange).toHaveBeenLastCalledWith({ review: 'pending' });

    view.rerender(toolbar('pending', onChange));
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    expect(onChange).toHaveBeenLastCalledWith({ review: undefined });
  });

  it('hides the count when no bot order waits', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ ...common, 'GET /orders/review-count': { status: 200, body: { pending: 0 } } })
        .fetchStub,
    );
    renderWithProviders(toolbar(undefined));
    const chip = screen.getByRole('button', { name: 'Bot · chờ duyệt' });
    await new Promise((r) => setTimeout(r, 50));
    expect(chip).toHaveAccessibleName('Bot · chờ duyệt');
  });

  it('sends review=pending to the list API', async () => {
    expect(toOrderQuery({ review: 'pending' })).toEqual({ review: 'pending' });
    const stub = stubFetch({
      ...common,
      'GET /orders?review=pending&page=1&pageSize=20': {
        status: 200,
        body: listBody([botPending]),
      },
    });
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => (
      <TooltipProvider>
        <OrdersList search={{ review: 'pending' }} onSearch={() => {}} />
      </TooltipProvider>
    ));
    expect(await screen.findByText('Chờ duyệt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bot · chờ duyệt/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('OrderReviewBanner (order detail)', () => {
  it('asks to review a pending bot order, approves it and links the conversation', async () => {
    const stub = stubFetch(common);
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithProviders(<OrderReviewBanner order={detail({})} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Đơn do bot tạo từ hội thoại — cần kiểm tra trước khi xử lý',
    );
    const link = screen.getByRole('link', { name: /Mở hội thoại/ });
    expect(link).toHaveAttribute('href', `/app/inbox?conversation=${CONVERSATION}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Duyệt đơn' }));
    await waitFor(() =>
      expect(stub.calls.find((c) => c.key.endsWith('/approve'))?.body).toEqual({ approve: true }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Đã duyệt đơn DH0001', expect.anything()),
    );
  });

  it('shows who approved it and when once approved', () => {
    renderWithProviders(<OrderReviewBanner order={approved} />);
    expect(
      screen.getByText(
        `Bot tạo · duyệt bởi Thu Hà lúc ${formatDateTime('2026-10-31T09:15:00.000Z')}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duyệt đơn' })).toBeNull();
    expect(screen.getByRole('link', { name: /Mở hội thoại/ })).toHaveAttribute(
      'href',
      `/app/inbox?conversation=${CONVERSATION}`,
    );
  });

  it('renders nothing for a staff order', () => {
    const { container } = renderWithProviders(
      <OrderReviewBanner order={{ ...staffOrder, id: STAFF_ORDER }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
