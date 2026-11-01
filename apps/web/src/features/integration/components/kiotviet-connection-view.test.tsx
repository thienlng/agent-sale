import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { SYNC_POLL_MS } from '../api/integrations';
import { BRANCHES, connection, rejected } from './fixtures';
import { KiotVietConnectionView } from './kiotviet-connection-view';

beforeAll(() => loadNamespace('integration'));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  toasts.success.mockReset();
  toasts.error.mockReset();
});

const LOG = {
  entries: [
    {
      id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01',
      level: 'info',
      code: 'full_sync_done',
      params: { products: 1240, images_failed: 0 },
      at: new Date().toISOString(),
    },
  ],
};

function setup(extra: Record<string, { status: number; body?: unknown }> = {}) {
  const { fetchStub, calls } = stubFetch({
    'GET /integrations/kiotviet/log': { status: 200, body: LOG },
    'GET /integrations': { status: 200, body: { providers: [] } },
    ...extra,
  });
  vi.stubGlobal('fetch', fetchStub);
  return { calls, user: userEvent.setup() };
}

describe('KiotVietConnectionView', () => {
  it('shows status, last sync, stats and recent activity', async () => {
    setup();
    renderWithProviders(<KiotVietConnectionView connection={connection()} canManage />);
    expect(screen.getByRole('heading', { name: 'shopabc' })).toBeInTheDocument();
    expect(screen.getByText('Đã kết nối')).toBeInTheDocument();
    expect(screen.getByText(/Đồng bộ lần cuối 2 phút trước/)).toBeInTheDocument();
    const products = screen.getByText('Sản phẩm liên kết').parentElement as HTMLElement;
    expect(within(products).getByText('1.240')).toHaveClass('tabular-nums');
    expect(await screen.findByText('Đã đồng bộ 1.240 sản phẩm')).toBeInTheDocument();
  });

  it('shows progress while syncing and the page polls', async () => {
    setup();
    renderWithProviders(
      <KiotVietConnectionView
        connection={connection({
          status: 'syncing',
          progress: { phase: 'products', done: 300, total: 1240 },
        })}
        canManage
      />,
    );
    expect(screen.getByText('Đang đồng bộ')).toBeInTheDocument();
    expect(screen.getByText('Đang nhập sản phẩm 300/1.240')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đồng bộ ngay' })).toBeDisabled();
    expect(SYNC_POLL_MS).toBe(3000);
  });

  it('is read-only without settings.manage', async () => {
    setup();
    renderWithProviders(<KiotVietConnectionView connection={connection()} canManage={false} />);
    await screen.findByText('Đã đồng bộ 1.240 sản phẩm');
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByRole('checkbox', { name: BRANCHES[0]!.name })).toBeDisabled();
    expect(screen.queryByText('Ngắt kết nối')).toBeNull();
  });

  it('offers "Cập nhật mã" when KiotViet rejected the secret, and sends new credentials', async () => {
    const { user, calls } = setup({
      'PATCH /integrations/kiotviet': rejected('kiotviet_retailer_changed'),
    });
    renderWithProviders(
      <KiotVietConnectionView
        connection={connection({
          status: 'error',
          lastError: { code: 'auth_failed', at: new Date().toISOString() },
        })}
        canManage
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('KiotViet từ chối mã bảo mật');
    expect(screen.getAllByRole('button', { name: 'Cập nhật mã' })).toHaveLength(1);
    await user.click(within(alert).getByRole('button', { name: 'Cập nhật mã' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Tên gian hàng')).toHaveValue('shopabc');
    await user.type(within(dialog).getByLabelText('Client ID'), 'new-id');
    await user.type(within(dialog).getByLabelText('Mã bảo mật'), 'new-secret');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(
      await within(dialog).findByText(
        'Mã mới thuộc gian hàng khác. Muốn đổi gian hàng, hãy ngắt kết nối rồi kết nối lại.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Tên gian hàng')).toHaveFocus();
    expect(calls.find((c) => c.key === 'PATCH /integrations/kiotviet')?.body).toEqual({
      credentials: { retailer: 'shopabc', clientId: 'new-id', clientSecret: 'new-secret' },
      version: 3,
    });
  });

  it('saves changed branches with the version', async () => {
    const { user, calls } = setup({
      'PATCH /integrations/kiotviet': { status: 200, body: connection({ version: 4 }) },
    });
    renderWithProviders(<KiotVietConnectionView connection={connection()} canManage />);
    const save = screen.getByRole('button', { name: 'Lưu' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[1]!.name }));
    await user.click(save);
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Đã lưu cài đặt đồng bộ.'));
    expect(toasts.error).not.toHaveBeenCalled();
    expect(calls.find((c) => c.key === 'PATCH /integrations/kiotviet')?.body).toEqual({
      settings: {
        saleBranchIds: [11, 12],
        orderBranchId: 11,
        pushOrders: true,
        syncCustomers: true,
      },
      version: 3,
    });
  });

  it('queues a sync', async () => {
    const { user, calls } = setup({ 'POST /integrations/kiotviet/sync': { status: 202 } });
    renderWithProviders(<KiotVietConnectionView connection={connection()} canManage />);
    await user.click(screen.getByRole('button', { name: 'Đồng bộ ngay' }));
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Đã bắt đầu đồng bộ.'));
    expect(calls.some((c) => c.key === 'POST /integrations/kiotviet/sync')).toBe(true);
  });

  it('disconnects only after confirming in a dialog', async () => {
    const { user, calls } = setup({ 'DELETE /integrations/kiotviet': { status: 204 } });
    renderWithProviders(<KiotVietConnectionView connection={connection()} canManage />);
    await user.click(screen.getByRole('button', { name: 'Ngắt kết nối' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Ngắt kết nối KiotViet?' });
    expect(dialog).toHaveTextContent('Dữ liệu đã đồng bộ được giữ lại.');
    expect(calls.some((c) => c.key === 'DELETE /integrations/kiotviet')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Ngắt kết nối' }));
    await vi.waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith('Đã ngắt kết nối KiotViet.'),
    );
    expect(calls.some((c) => c.key === 'DELETE /integrations/kiotviet')).toBe(true);
  });
});
