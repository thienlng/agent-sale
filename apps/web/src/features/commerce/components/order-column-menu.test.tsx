import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { presetRange } from '@/components/date-range-picker';
import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithProviders, renderWithRouter, stubFetch } from '@/testing/render';

import { columnMenu, type OrderFilterContext } from './order-column-filters';
import { OrderColumnMenu } from './order-column-menu';
import { OrdersFilterSheet } from './orders-filter-sheet';
import { OrdersList } from './orders-list';
import { type OrdersSearch, parseOrdersSearch, toOrderQuery } from './orders-search';
import { OrdersToolbar } from './orders-toolbar';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const STAFF = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const ctx = (over: Partial<OrderFilterContext> = {}): OrderFilterContext => ({
  statuses: ['new', 'confirmed', 'cancelled'],
  statusCounts: { all: 9, new: 4, confirmed: 3, cancelled: 2 },
  facets: {
    creators: [{ id: STAFF, name: 'Ngọc Anh' }],
    carriers: ['GHN', 'Viettel Post'],
    counts: {
      source: { facebook: 5, manual: 4 },
      creator: { bot_pending: 3, bot_approved: 2, [STAFF]: 4 },
      carrier: { GHN: 6, 'Viettel Post': 1 },
    },
  },
  pendingReview: 0,
  ...over,
});

function menu(id: string, search: OrdersSearch = {}, c = ctx()) {
  const onChange = vi.fn();
  const view = renderWithProviders(
    <TooltipProvider>
      <OrderColumnMenu spec={columnMenu(id)!} search={search} onChange={onChange} ctx={c} />
    </TooltipProvider>,
  );
  return { onChange, view, user: userEvent.setup() };
}

describe('orders URL state', () => {
  it('maps old links to the column filters', () => {
    expect(parseOrdersSearch({ createdBy: STAFF })).toEqual({ creator: [STAFF] });
    expect(parseOrdersSearch({ review: 'pending', createdBy: STAFF })).toEqual({
      creator: ['bot_pending', STAFF],
    });
    expect(parseOrdersSearch({ source: 'facebook' })).toEqual({ source: ['facebook'] });
    expect(parseOrdersSearch({ status: 'new', sort: 'total_desc' })).toEqual({
      status: ['new'],
      sort: 'total_desc',
    });
  });

  it('drops malformed values instead of failing', () => {
    expect(
      parseOrdersSearch({ creator: ['nobody'], totalMin: -5, sort: 'bogus_asc', code: '' }),
    ).toEqual({});
  });

  it('sends lists as comma-separated parameters', () => {
    expect(
      toOrderQuery({
        creator: ['bot_pending', STAFF],
        carrier: ['GHN', 'Viettel Post'],
        source: ['facebook'],
        status: ['new'],
        statusMode: 'exclude',
        totalMin: 100_000,
        code: 'DH1',
        sort: 'cod_asc',
      }),
    ).toEqual({
      status: 'new',
      statusMode: 'exclude',
      creator: `bot_pending,${STAFF}`,
      carrier: 'GHN,Viettel Post',
      source: 'facebook',
      totalMin: 100_000,
      code: 'DH1',
      sort: 'cod_asc',
    });
  });
});

describe('column header menu', () => {
  it('describes its state in the accessible name', () => {
    menu('code', { code: 'DH', sort: 'code_asc' });
    const trigger = screen.getByRole('button', {
      name: 'Mã đơn, đang lọc, sắp xếp tăng dần',
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('sorts, and choosing the active order again goes back to the default', async () => {
    const { onChange, user, view } = menu('total');
    await user.click(screen.getByRole('button', { name: 'Tiền cần thu' }));
    await user.click(await screen.findByRole('button', { name: 'Sắp xếp giảm dần' }));
    expect(onChange).toHaveBeenLastCalledWith({ sort: 'total_desc' });

    view.unmount();
    const again = menu('total', { sort: 'total_desc' });
    await again.user.click(screen.getByRole('button', { name: 'Tiền cần thu, sắp xếp giảm dần' }));
    const desc = await screen.findByRole('button', { name: 'Sắp xếp giảm dần' });
    expect(desc).toHaveAttribute('aria-pressed', 'true');
    await again.user.click(desc);
    expect(again.onChange).toHaveBeenLastCalledWith({ sort: undefined });
  });

  it('applies a text filter on Enter', async () => {
    const { onChange, user } = menu('products');
    await user.click(screen.getByRole('button', { name: 'Sản phẩm' }));
    await user.type(await screen.findByLabelText('Sản phẩm có chứa'), '  tháp {Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ product: 'tháp' });
  });

  it('lists bot states first, then staff, with counts, and applies the ticked ones', async () => {
    const { onChange, user } = menu('creator');
    await user.click(screen.getByRole('button', { name: 'Người tạo' }));
    const list = within(await screen.findByRole('list', { name: 'Người tạo' }));
    const rows = list.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['Bot · chờ duyệt3', 'Bot · đã duyệt2', 'Ngọc Anh4']);
    await user.click(list.getByRole('checkbox', { name: /Bot · chờ duyệt/ }));
    await user.click(list.getByRole('checkbox', { name: /Ngọc Anh/ }));
    await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onChange).toHaveBeenLastCalledWith({ creator: ['bot_pending', STAFF] });
  });

  it('searches inside the checklist and shows no numbers without counts', async () => {
    const c = ctx();
    const { user } = menu('carrier', {}, { ...c, facets: { ...c.facets!, counts: undefined } });
    await user.click(screen.getByRole('button', { name: 'ĐVVC' }));
    await user.type(await screen.findByLabelText('Tìm trong danh sách ĐVVC'), 'viettel');
    const rows = within(screen.getByRole('list', { name: 'ĐVVC' })).getAllByRole('listitem');
    expect(rows.map((li) => li.textContent)).toEqual(['Viettel Post']);
  });

  it('treats "everything ticked" as no filter and clears a column', async () => {
    const { onChange, user } = menu('source', { source: ['facebook'] });
    await user.click(screen.getByRole('button', { name: 'Nguồn, đang lọc' }));
    await user.click(await screen.findByRole('button', { name: 'Chọn tất cả' }));
    await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onChange).toHaveBeenLastCalledWith({ source: undefined });

    await user.click(screen.getByRole('button', { name: 'Nguồn, đang lọc' }));
    await user.click(await screen.findByRole('button', { name: 'Xoá lọc cột' }));
    expect(onChange).toHaveBeenLastCalledWith({ source: undefined });
  });

  it('orders a money range and applies on Enter', async () => {
    const { onChange, user } = menu('cod');
    await user.click(screen.getByRole('button', { name: 'Còn thu (COD)' }));
    await user.type(await screen.findByLabelText('Từ'), '500000');
    await user.type(screen.getByLabelText('Đến'), '100000{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ codMin: 100_000, codMax: 500_000 });
  });

  it('filters statuses in exclude mode', async () => {
    const { onChange, user } = menu('status');
    await user.click(screen.getByRole('button', { name: 'Trạng thái' }));
    await user.click(await screen.findByRole('checkbox', { name: /Đã huỷ/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Loại trừ các mục đã chọn' }));
    await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onChange).toHaveBeenLastCalledWith({ status: ['cancelled'], statusMode: 'exclude' });
  });

  it('applies a date preset at once', async () => {
    const { onChange, user } = menu('placedAt');
    await user.click(screen.getByRole('button', { name: 'Tạo lúc, sắp xếp giảm dần' }));
    await user.click(await screen.findByRole('button', { name: '7 ngày' }));
    expect(onChange).toHaveBeenLastCalledWith(presetRange('last7'));
  });

  it('marks pending bot orders on the "Người tạo" header with a tooltip', async () => {
    const { user } = menu('creator', {}, ctx({ pendingReview: 3 }));
    const trigger = screen.getByRole('button', { name: 'Người tạo, 3 đơn bot chờ duyệt' });
    expect(screen.getByTestId('pending-review-dot')).toBeInTheDocument();
    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('3 đơn bot chờ duyệt');
    await user.click(trigger);
    expect(await screen.findByRole('list', { name: 'Người tạo' })).toBeInTheDocument();
  });
});

describe('orders toolbar', () => {
  const toolbar = (search: OrdersSearch, onChange = vi.fn()) => {
    renderWithProviders(
      <TooltipProvider>
        <OrdersToolbar
          search={search}
          onChange={onChange}
          ctx={ctx()}
          onExport={() => {}}
          exporting={false}
        />
      </TooltipProvider>,
    );
    return onChange;
  };

  it('shows one chip per filtered column, hidden columns included, and removes them', async () => {
    const onChange = toolbar({
      creator: ['bot_pending'],
      totalMin: 100_000,
      totalMax: 500_000,
      ...presetRange('last7'),
      // "Ghi chú" is hidden by default.
      note: 'gấp',
    });
    const chips = within(screen.getByRole('list', { name: 'Bộ lọc đang áp dụng' }));
    expect(chips.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Tiền cần thu: 100.000–500.000 ₫',
      'Ghi chú: “gấp”',
      'Người tạo: Bot · chờ duyệt',
      'Tạo lúc: 7 ngày',
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bỏ lọc Người tạo: Bot · chờ duyệt' }));
    expect(onChange).toHaveBeenLastCalledWith({ creator: undefined });
    await user.click(screen.getByRole('button', { name: 'Xoá lọc' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: undefined,
        creator: undefined,
        from: undefined,
        note: undefined,
      }),
    );
  });

  it('has no bot quick filter, status/source selects or sort select any more', () => {
    toolbar({});
    expect(screen.queryByRole('button', { name: /Bot · chờ duyệt/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xoá lọc' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeInTheDocument();
  });
});

describe('"Lọc & sắp xếp" sheet (phones)', () => {
  it('lists every column and opens its editor', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <OrdersFilterSheet search={{ creator: ['bot_pending'] }} onChange={onChange} ctx={ctx()} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Lọc & sắp xếp.*1 cột đang lọc/ }));
    const sheet = within(await screen.findByRole('dialog', { name: 'Lọc & sắp xếp' }));
    await user.click(sheet.getByRole('button', { name: /Người tạo.*Bot · chờ duyệt/ }));
    const list = within(sheet.getByRole('list', { name: 'Người tạo' }));
    expect(list.getByRole('checkbox', { name: /Bot · chờ duyệt/ })).toBeChecked();
    await user.click(list.getByRole('checkbox', { name: /Bot · đã duyệt/ }));
    await user.click(sheet.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ creator: ['bot_pending', 'bot_approved'] }),
    );
    expect(sheet.getByRole('button', { name: /Mã vận đơn/ })).toBeInTheDocument();
  });
});

describe('orders list headers', () => {
  it('filters from a header menu, back to page 1, and marks the sorted header', async () => {
    const stub = stubFetch({
      'GET /order-settings': {
        status: 200,
        body: { extraStatuses: [], requireNoteStatuses: [], policies: [], version: 0 },
      },
      'GET /orders/review-count': { status: 200, body: { pending: 0 } },
      'GET /orders?sort=code_asc&page=3&pageSize=20': {
        status: 200,
        body: {
          data: [],
          total: 0,
          page: 3,
          pageSize: 20,
          counts: { all: 0 },
          totals: { itemQty: 0, shippingFeeCharged: 0, cod: 0, gross: 0, total: 0 },
          facets: { creators: [], carriers: [] },
        },
      },
    });
    vi.stubGlobal('fetch', stub.fetchStub);
    const onSearch = vi.fn();
    renderWithRouter(() => (
      <TooltipProvider>
        <OrdersList search={{ sort: 'code_asc', page: 3 }} onSearch={onSearch} />
      </TooltipProvider>
    ));
    const user = userEvent.setup();
    const header = await screen.findByRole(
      'button',
      { name: 'Mã đơn, sắp xếp tăng dần' },
      { timeout: 5000 },
    );
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    await user.click(header);
    await user.type(await screen.findByLabelText('Mã đơn có chứa'), 'DH12{Enter}');
    expect(onSearch).toHaveBeenLastCalledWith({ sort: 'code_asc', code: 'DH12', page: 1 });
  });
});
