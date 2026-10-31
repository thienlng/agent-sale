import type { OrderDto, OrderSummaryDto } from '@agent-sales/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { formatDateTime } from '@/lib/format';
import { renderWithProviders, renderWithRouter, stubFetch } from '@/testing/render';

import { APPROVE_UNDO_MS } from '../hooks/use-approve-order';
import { OrderReviewBanner } from './order-review-banner';
import { OrdersList } from './orders-list';
import { parseOrdersSearch, toOrderQuery } from './orders-search';

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
const SECOND_BOT_ORDER = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e61';
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
  itemCount: 1,
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

/** The desktop table (the mobile cards repeat the chips). */
const table = () => within(screen.getByRole('table'));

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
    await user.click(
      await screen.findByRole('button', { name: 'Thao tác với đơn DH0002' }, { timeout: 5000 }),
    );
    expect(await screen.findByRole('menuitem', { name: 'Xem chi tiết' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Duyệt đơn' })).toBeNull();
    await user.keyboard('{Escape}');

    expect(table().getByText('Chờ duyệt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thao tác với đơn DH0001' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duyệt đơn' }));

    // Optimistic: the row reads "Đã duyệt" before the server answers.
    expect(await table().findByText('Đã duyệt')).toBeInTheDocument();
    expect(table().queryByText('Chờ duyệt')).toBeNull();
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
    await user.click(
      await screen.findByRole('button', { name: 'Thao tác với đơn DH0001' }, { timeout: 5000 }),
    );
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

describe('approving: concurrency and failure', () => {
  const renderList = () =>
    renderWithRouter(() => (
      <TooltipProvider>
        <OrdersList search={{}} onSearch={() => {}} />
      </TooltipProvider>
    ));

  it('gives two quick approvals each their own toast and undo', async () => {
    const second = summary({ id: SECOND_BOT_ORDER, code: 'DH0003' });
    const stub = stubFetch({
      ...common,
      'GET /orders?page=1&pageSize=20': { status: 200, body: listBody([botPending, second]) },
      [`POST /orders/${SECOND_BOT_ORDER}/approve`]: {
        status: 200,
        body: { ...approved, id: SECOND_BOT_ORDER, code: 'DH0003' },
      },
    });
    const { held, release } = holdApprove(stub.fetchStub);
    vi.stubGlobal('fetch', held);
    const user = userEvent.setup();
    renderList();
    for (const code of ['DH0001', 'DH0003']) {
      await user.click(
        await screen.findByRole('button', { name: `Thao tác với đơn ${code}` }, { timeout: 5000 }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Duyệt đơn' }));
    }
    // Both are in flight together, then both answer.
    release();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    const calls = toast.success.mock.calls as Array<[string, { action: { onClick: () => void } }]>;
    expect(calls.map(([m]) => m).sort()).toEqual(['Đã duyệt đơn DH0001', 'Đã duyệt đơn DH0003']);

    calls.find(([m]) => m.endsWith('DH0001'))![1].action.onClick();
    await waitFor(() =>
      expect(stub.calls.filter((c) => c.key === `POST /orders/${BOT_ORDER}/approve`)).toHaveLength(
        2,
      ),
    );
    expect(
      stub.calls.filter((c) => c.key === `POST /orders/${BOT_ORDER}/approve`)[1]!.body,
    ).toEqual({ approve: false });
    expect(
      stub.calls.filter((c) => c.key === `POST /orders/${SECOND_BOT_ORDER}/approve`),
    ).toHaveLength(1);
  });

  it('rolls the row back and shows an error when approving fails', async () => {
    const stub = stubFetch({
      ...common,
      'GET /orders?page=1&pageSize=20': { status: 200, body: listBody([botPending]) },
      [`POST /orders/${BOT_ORDER}/approve`]: {
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'changed' } },
      },
    });
    const { held, release } = holdApprove(stub.fetchStub);
    vi.stubGlobal('fetch', held);
    const user = userEvent.setup();
    renderList();
    await user.click(
      await screen.findByRole('button', { name: 'Thao tác với đơn DH0001' }, { timeout: 5000 }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Duyệt đơn' }));
    expect(await table().findByText('Đã duyệt')).toBeInTheDocument();
    release();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(await table().findByText('Chờ duyệt')).toBeInTheDocument();
    expect(table().queryByText('Đã duyệt')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

// The old toolbar quick filter now lives in the "Người tạo" column menu (creator=bot_pending).
describe('"Bot · chờ duyệt" in the "Người tạo" column', () => {
  it('maps the old review=pending link and sends creator=bot_pending to the list API', async () => {
    const search = parseOrdersSearch({ review: 'pending' });
    expect(search).toEqual({ creator: ['bot_pending'] });
    expect(toOrderQuery(search)).toEqual({ creator: 'bot_pending' });
    const stub = stubFetch({
      ...common,
      'GET /orders?creator=bot_pending&page=1&pageSize=20': {
        status: 200,
        body: listBody([botPending]),
      },
    });
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => (
      <TooltipProvider>
        <OrdersList search={search} onSearch={() => {}} />
      </TooltipProvider>
    ));
    await screen.findByRole('table', undefined, { timeout: 5000 });
    expect(await table().findByText('Chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText('Người tạo: Bot · chờ duyệt')).toBeInTheDocument();
    // The header says the column is filtered and that 3 bot orders wait (review-count).
    expect(
      await screen.findByRole('button', {
        name: 'Người tạo, đang lọc, 3 đơn bot chờ duyệt',
      }),
    ).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('shows no pending dot when no bot order waits', async () => {
    let signal = () => {};
    const answered = new Promise<void>((r) => (signal = r));
    const stub = stubFetch({
      ...common,
      'GET /orders/review-count': { status: 200, body: { pending: 0 } },
      'GET /orders?page=1&pageSize=20': { status: 200, body: listBody([staffOrder]) },
    });
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const res = await stub.fetchStub(input, init);
      if (input.endsWith('/orders/review-count')) signal();
      return res;
    });
    renderWithRouter(() => (
      <TooltipProvider>
        <OrdersList search={{}} onSearch={() => {}} />
      </TooltipProvider>
    ));
    await answered;
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByRole('button', { name: 'Người tạo' })).toBeInTheDocument();
    expect(screen.queryByTestId('pending-review-dot')).toBeNull();
  });
});

describe('OrderReviewBanner (order detail)', () => {
  it('asks to review a pending bot order, approves it and links the conversation', async () => {
    const stub = stubFetch(common);
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithProviders(<OrderReviewBanner order={detail({})} />);
    expect(screen.getByRole('region', { name: 'Đơn do bot tạo cần duyệt' })).toHaveTextContent(
      'Đơn do bot tạo từ hội thoại — cần kiểm tra trước khi xử lý',
    );
    const link = screen.getByRole('link', { name: /Mở hội thoại/ });
    expect(link).toHaveAttribute('href', `/app/inbox?conversation=${CONVERSATION}&ws=ws-1`);
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
      `/app/inbox?conversation=${CONVERSATION}&ws=ws-1`,
    );
  });

  it('renders nothing for a staff order', () => {
    const { container } = renderWithProviders(
      <OrderReviewBanner order={{ ...staffOrder, id: STAFF_ORDER }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
