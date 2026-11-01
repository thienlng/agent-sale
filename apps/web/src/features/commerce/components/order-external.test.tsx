import type { OrderDto, OrderSummaryDto } from '@agent-sales/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiClientError } from '@/lib/api-client';
import { i18n } from '@/lib/i18n';
import { renderWithProviders, renderWithRouter, stubFetch } from '@/testing/render';

import { orderErrorMessage } from '../hooks/order-errors';
import { OrderDetail } from './order-detail';
import {
  OrderExternalChip,
  OrderPushPanel,
  pushErrorMessage,
  RetryPushProvider,
} from './order-external';
import { OrdersList } from './orders-list';
import { parseOrdersSearch } from './orders-search';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
const perms = vi.hoisted(() => ({ manage: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => perms.manage }));
afterEach(() => {
  vi.unstubAllGlobals();
  perms.manage = true;
  toast.success.mockClear();
  toast.error.mockClear();
});

const ORDER = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
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
const summary = (over: Partial<OrderSummaryDto> = {}): OrderSummaryDto => ({
  id: ORDER,
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
    { name: 'Áo thun', qty: 1, variantName: null, unitPrice: 100_000, imageUrl: null },
  ],
  createdByName: 'Ngọc Anh',
  createdByKind: 'agent',
  reviewState: null,
  reviewedByName: null,
  reviewedAt: null,
  conversationId: null,
  itemCount: 1,
  external: null,
  placedAt: '2026-10-31T08:00:00.000Z',
  ...over,
});
const detail = (over: Partial<OrderDto> = {}): OrderDto => ({
  ...summary(),
  warehouseId: '5f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
  warehouseName: 'Kho chính',
  expectedDeliveryAt: null,
  notePrint: '',
  items: [],
  history: [],
  stockState: 'external',
  createdAt: '2026-10-31T08:00:00.000Z',
  updatedAt: '2026-10-31T08:00:00.000Z',
  ...over,
});

const pending = { state: 'pending' as const, code: null, status: null, error: null };
const pushed = { state: 'pushed' as const, code: 'DH000123', status: 'confirmed', error: null };
const failed = {
  state: 'failed' as const,
  code: null,
  status: null,
  error: { code: 'unlinked_product', params: { name: 'Quần jean' } },
};

const withTooltips = (ui: React.ReactElement) => <TooltipProvider>{ui}</TooltipProvider>;

describe('KiotViet push chip', () => {
  it('names each state', () => {
    renderWithProviders(
      withTooltips(
        <>
          <OrderExternalChip order={summary({ external: pending })} />
          <OrderExternalChip order={summary({ external: pushed })} />
          <OrderExternalChip order={summary({ external: failed })} />
        </>,
      ),
    );
    expect(screen.getByText('Đang đẩy')).toBeInTheDocument();
    expect(screen.getByText('Đã đẩy · DH000123')).toBeInTheDocument();
    expect(screen.getByText('Lỗi')).toBeInTheDocument();
  });

  it('renders nothing for an order that was never pushed', () => {
    const { container } = renderWithProviders(
      withTooltips(<OrderExternalChip order={summary()} />),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('retries a failed push and says so', async () => {
    const retry = vi.fn().mockResolvedValue(null);
    renderWithProviders(
      withTooltips(<OrderExternalChip order={summary({ external: failed })} onRetry={retry} />),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(retry).toHaveBeenCalledWith(ORDER);
    expect(toast.success).toHaveBeenCalledWith('Đã gửi lại đơn sang KiotViet.');
  });

  it('explains a 409 when the push is no longer failed', async () => {
    const retry = vi.fn().mockRejectedValue(new ApiClientError(409, 'CONFLICT', 'not failed'));
    renderWithProviders(
      withTooltips(<OrderExternalChip order={summary({ external: failed })} onRetry={retry} />),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(toast.error).toHaveBeenCalledWith(
      'Đơn này không còn lỗi đẩy — trạng thái đã được tải lại.',
    );
  });

  it('hides "Thử lại" without orders.manage', () => {
    perms.manage = false;
    renderWithProviders(
      withTooltips(<OrderExternalChip order={summary({ external: failed })} onRetry={vi.fn()} />),
    );
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });
});

describe('push error copy', () => {
  const t = i18n.t.bind(i18n);
  it.each([
    [
      { code: 'unlinked_product', params: { name: 'Quần jean' } },
      'Sản phẩm Quần jean không có trên KiotViet',
    ],
    [{ code: 'kiotviet_rejected' }, 'KiotViet từ chối đơn — kiểm tra lại thông tin đơn'],
    [{ code: 'kiotviet_unavailable' }, 'KiotViet không phản hồi — thử lại sau ít phút'],
    [
      { code: 'auth_failed' },
      'KiotViet từ chối mã kết nối — cập nhật mã trong Tích hợp PMS rồi thử lại',
    ],
    [{ code: 'something_new' }, 'Chưa đẩy được đơn sang KiotViet'],
  ])('%o', (error, text) => {
    expect(pushErrorMessage(t, error)).toBe(text);
  });

  it('has copy for every code the backend sets', () => {
    for (const code of [
      'unlinked_product',
      'empty_order',
      'kiotviet_rejected',
      'kiotviet_unavailable',
      'kiotviet_link_conflict',
      'auth_failed',
      'not_connected',
      'sync_failed',
    ]) {
      expect(i18n.exists(`orders.push.errors.${code}`)).toBe(true);
    }
  });
});

describe('KiotViet panel on the order page', () => {
  it('says a pushed order is updated in KiotViet', () => {
    renderWithProviders(withTooltips(<OrderPushPanel order={detail({ external: pushed })} />));
    expect(screen.getByText('Đã đẩy · DH000123')).toBeInTheDocument();
    expect(
      screen.getByText('Đơn đã ở KiotViet — cập nhật trạng thái trên KiotViet'),
    ).toBeInTheDocument();
    expect(screen.getByText('Trạng thái trên KiotViet: Đã xác nhận')).toBeInTheDocument();
  });

  it('shows the failure and "Thử lại"', async () => {
    const retry = vi.fn().mockResolvedValue(null);
    renderWithProviders(
      withTooltips(<OrderPushPanel order={detail({ external: failed })} onRetry={retry} />),
    );
    expect(screen.getByText('Sản phẩm Quần jean không có trên KiotViet')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(retry).toHaveBeenCalledWith(ORDER);
  });

  it('is absent for an order never pushed', () => {
    const { container } = renderWithProviders(withTooltips(<OrderPushPanel order={detail()} />));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('order editors while a push is pending', () => {
  it('asks to wait a few seconds', () => {
    const t = i18n.t.bind(i18n);
    const err = new ApiClientError(409, 'CONFLICT', 'pending', undefined, {
      stockState: 'reserved',
      reason: 'PUSH_PENDING',
    });
    expect(orderErrorMessage(t, err)).toBe(
      'Đơn đang được đẩy sang KiotViet, chờ vài giây rồi sửa lại.',
    );
  });
});

const settings = {
  'GET /order-settings': {
    status: 200,
    body: { extraStatuses: [], requireNoteStatuses: [], policies: [], version: 0 },
  },
  'GET /orders/review-count': { status: 200, body: { pending: 0 } },
};
const listBody = (rows: OrderSummaryDto[]) => ({
  data: rows,
  total: rows.length,
  page: 1,
  pageSize: 20,
  counts: { all: rows.length },
  totals: { itemQty: rows.length, shippingFeeCharged: 0, cod: 0, gross: 0, total: 0 },
  facets: { creators: [], carriers: [] },
});

describe('orders list', () => {
  function renderList(rows: OrderSummaryDto[], onRetryPush?: (id: string) => Promise<unknown>) {
    const { fetchStub } = stubFetch({
      ...settings,
      'GET /orders?page=1&pageSize=20': { status: 200, body: listBody(rows) },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() =>
      withTooltips(
        <RetryPushProvider value={onRetryPush}>
          <OrdersList search={parseOrdersSearch({})} onSearch={() => {}} />
        </RetryPushProvider>,
      ),
    );
  }

  it('shows a KiotViet column once an order on the page was pushed', async () => {
    renderList([summary({ external: failed })], vi.fn().mockResolvedValue(null));
    const table = within(await screen.findByRole('table'));
    expect(await table.findByRole('columnheader', { name: 'KiotViet' })).toBeInTheDocument();
    expect(table.getByText('Lỗi')).toBeInTheDocument();
    expect(table.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('leaves the column out when nothing was pushed', async () => {
    renderList([summary()]);
    const table = within(await screen.findByRole('table'));
    await table.findByText('DH0001');
    expect(table.queryByRole('columnheader', { name: 'KiotViet' })).toBeNull();
  });
});

describe('order page', () => {
  it('passes "Thử lại" from the route down to the panel', async () => {
    const { fetchStub } = stubFetch({
      ...settings,
      [`GET /orders/${ORDER}`]: { status: 200, body: detail({ external: failed }) },
    });
    vi.stubGlobal('fetch', fetchStub);
    const retry = vi.fn().mockResolvedValue(null);
    renderWithRouter(() => withTooltips(<OrderDetail orderId={ORDER} onRetryPush={retry} />));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(retry).toHaveBeenCalledWith(ORDER);
  });
});

describe('editing notes while a push is pending', () => {
  it('leaves the carrier fee out, so the edit is not refused', async () => {
    const pendingOrder = detail({ external: pending, stockState: 'reserved' });
    const { fetchStub, calls } = stubFetch({
      ...settings,
      [`GET /orders/${ORDER}`]: { status: 200, body: pendingOrder },
      [`PATCH /orders/${ORDER}`]: { status: 200, body: pendingOrder },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => withTooltips(<OrderDetail orderId={ORDER} />));
    const user = userEvent.setup();
    const heading = await screen.findByRole('heading', { name: 'Vận chuyển · Ghi chú' });
    const panel = within(heading.closest('section') as HTMLElement);
    await user.click(panel.getByRole('button', { name: 'Sửa' }));
    await user.type(panel.getByLabelText('Nội bộ'), 'Gọi trước khi giao');
    await user.click(panel.getByRole('button', { name: 'Lưu' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã lưu đơn hàng'));
    const body = calls.find((c) => c.key === `PATCH /orders/${ORDER}`)?.body as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ noteInternal: 'Gọi trước khi giao' });
    expect(body).not.toHaveProperty('shippingFee');
  });
});
