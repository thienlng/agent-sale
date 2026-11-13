import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StepUpHost } from '@/components/step-up-dialog';
import { loadNamespace } from '@/lib/i18n';
import { renderWithRouter, stepUpStatus, stubFetch, stubFetchSequence } from '@/testing/render';

import { expiryFromDate } from './create-api-key-dialog';
import { DevelopersPage } from './developers-page';
import { apiKey, delivery, endpoint } from './fixtures';

beforeAll(() => loadNamespace('developer'));
const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  can.value = true;
});

// Fake values, built from parts so secret scanners don't mistake them for real ones.
const FULL_KEY = ['rpz_live', 'abcdefghijkl', '0'.repeat(32)].join('_');
const SECRET = ['whsec', 'x'.repeat(16)].join('_');

function setup(
  extra: Record<string, { status: number; body?: unknown }> = {},
  apiEnabled: boolean | undefined = true,
) {
  const stub = stubFetch({
    'GET /api-keys': { status: 200, body: { data: [apiKey()] } },
    'GET /webhook-endpoints': { status: 200, body: { data: [endpoint()] } },
    ...extra,
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => <DevelopersPage apiEnabled={apiEnabled} />);
  return stub.calls;
}

describe('DevelopersPage', () => {
  it('is closed to members without developer.manage', async () => {
    can.value = false;
    setup();
    expect(
      await screen.findByText(
        'Chỉ chủ doanh nghiệp hoặc quản trị viên mới quản lý được khóa API và webhook.',
      ),
    ).toBeInTheDocument();
  });

  it('lists keys and webhooks and links to the public OpenAPI document', async () => {
    setup();
    expect(await screen.findByText('ERP sync')).toBeInTheDocument();
    expect(screen.getByText('rpz_live_abcdefghijkl…')).toBeInTheDocument();
    expect(screen.getByText('Xem khách hàng được giao, Xem đơn hàng')).toBeInTheDocument();
    expect(await screen.findByText('https://erp.example.com/hooks/rapiz')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tài liệu API (OpenAPI)' })).toHaveAttribute(
      'href',
      '/api/v1/public/openapi.json',
    );
  });

  it('shows an upgrade notice and nothing to create when the plan has no public API', async () => {
    setup({}, false);
    expect(await screen.findByText('Gói hiện tại chưa có API công khai')).toBeInTheDocument();
    expect(await screen.findByText('ERP sync')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tạo khóa API' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm webhook' })).toBeNull();
    // Existing keys can still be revoked.
    expect(screen.getByRole('button', { name: 'Thu hồi ERP sync' })).toBeInTheDocument();
  });

  it('creates a key with the picked scopes and shows the full key once', async () => {
    const calls = setup({
      'POST /api-keys': { status: 201, body: { apiKey: apiKey(), key: FULL_KEY } },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Tạo khóa API' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo khóa' }));
    expect(within(dialog).getByText('Nhập tên khóa')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Tên khóa'), '  POS  ');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo khóa' }));
    expect(within(dialog).getByText('Chọn ít nhất một quyền')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Xem đơn hàng' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Tạo và sửa khách hàng' }));
    await user.click(within(dialog).getByRole('button', { name: 'Tạo khóa' }));

    expect(await screen.findByTestId('revealed-secret')).toHaveTextContent(FULL_KEY);
    expect(calls.find((c) => c.key === 'POST /api-keys')?.body).toEqual({
      name: 'POS',
      // Catalog order, whatever the click order.
      scopes: ['orders.view', 'contacts.edit'],
      expiresAt: null,
    });
    await user.click(screen.getByRole('button', { name: 'Tôi đã lưu khóa' }));
    await waitFor(() => expect(screen.queryByTestId('revealed-secret')).toBeNull());
  });

  it('asks the user to confirm it is them when the sign-in is old, then creates the key', async () => {
    const reauth = {
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'x', details: { reason: 'reauth_required' } } },
    };
    const { fetchStub, calls } = stubFetchSequence({
      'GET /api-keys': { status: 200, body: { data: [apiKey()] } },
      'GET /webhook-endpoints': { status: 200, body: { data: [endpoint()] } },
      'POST /api-keys': [reauth, { status: 201, body: { apiKey: apiKey(), key: FULL_KEY } }],
      'GET /auth/reauth': { status: 200, body: stepUpStatus() },
      'POST /auth/reauth': [
        {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'x',
              details: { reason: 'invalid_password' },
            },
          },
        },
        { status: 200, body: stepUpStatus({ recent: true }) },
      ],
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => (
      <>
        <DevelopersPage apiEnabled />
        <StepUpHost />
      </>
    ));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Tạo khóa API' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tên khóa'), 'POS');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Xem đơn hàng' }));
    await user.click(within(dialog).getByRole('button', { name: 'Tạo khóa' }));

    const stepUp = await screen.findByRole('dialog', { name: 'Xác nhận đó là bạn' });
    await user.type(within(stepUp).getByLabelText('Mật khẩu hiện tại'), 'wrong');
    await user.click(within(stepUp).getByRole('button', { name: 'Xác nhận' }));
    expect(await within(stepUp).findByRole('alert')).toHaveTextContent('Sai mật khẩu.');
    await user.clear(within(stepUp).getByLabelText('Mật khẩu hiện tại'));
    await user.type(within(stepUp).getByLabelText('Mật khẩu hiện tại'), 'the password');
    await user.click(within(stepUp).getByRole('button', { name: 'Xác nhận' }));

    expect(await screen.findByTestId('revealed-secret')).toHaveTextContent(FULL_KEY);
    expect(calls.filter((c) => c.key === 'POST /api-keys')).toHaveLength(2);
    expect(calls.filter((c) => c.key === 'POST /auth/reauth').map((c) => c.body)).toEqual([
      { password: 'wrong' },
      { password: 'the password' },
    ]);
  });

  it('revokes a key after confirmation', async () => {
    const calls = setup({
      'POST /api-keys/0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b01/revoke': {
        status: 200,
        body: apiKey({ status: 'revoked' }),
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thu hồi ERP sync' }));
    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }));
    await waitFor(() => expect(calls.some((c) => c.key.endsWith('/revoke'))).toBe(true));
  });

  it('adds a webhook, refusing non-HTTPS URLs, and shows the signing secret once', async () => {
    const calls = setup({
      'POST /webhook-endpoints': { status: 201, body: { endpoint: endpoint(), secret: SECRET } },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thêm webhook' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Địa chỉ nhận (HTTPS)'), 'http://erp.local/x');
    await user.click(within(dialog).getByRole('checkbox', { name: /Đơn hàng mới/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(within(dialog).getByText('Nhập địa chỉ bắt đầu bằng https://')).toBeInTheDocument();

    const url = within(dialog).getByLabelText('Địa chỉ nhận (HTTPS)');
    await user.clear(url);
    await user.type(url, 'https://erp.example.com/in');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByTestId('revealed-secret')).toHaveTextContent(SECRET);
    expect(calls.find((c) => c.key === 'POST /webhook-endpoints')?.body).toEqual({
      url: 'https://erp.example.com/in',
      description: '',
      events: ['commerce.order.created'],
    });
  });

  it('opens the delivery log and resends a failed delivery', async () => {
    const id = endpoint().id;
    const calls = setup({
      [`GET /webhook-endpoints/${id}/deliveries?limit=30`]: {
        status: 200,
        body: { data: [delivery()], page: { nextCursor: null } },
      },
      [`POST /webhook-deliveries/${delivery().id}/resend`]: {
        status: 202,
        body: delivery({ status: 'pending' }),
      },
    });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Thao tác https://erp.example.com/hooks/rapiz',
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Lịch sử gửi' }));
    expect(await screen.findByText('Internal Server Error')).toBeInTheDocument();
    expect(screen.getByText('8 lần thử · HTTP 500')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gửi lại' }));
    await waitFor(() => expect(calls.some((c) => c.key.endsWith('/resend'))).toBe(true));
  });
});

describe('expiryFromDate', () => {
  it('is the end of the picked local day, or null', () => {
    expect(expiryFromDate('')).toBeNull();
    const at = new Date(expiryFromDate('2027-03-15') ?? '');
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours()]).toEqual([
      2027, 2, 15, 23,
    ]);
  });
});
