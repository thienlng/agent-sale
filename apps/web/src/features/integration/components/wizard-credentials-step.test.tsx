import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { rejected, TEST_RESPONSE } from './fixtures';
import { KiotVietWizard } from './kiotviet-wizard';

beforeAll(() => loadNamespace('integration'));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Tên gian hàng'), 'https://shopabc.kiotviet.vn/man');
  await user.type(screen.getByLabelText('Client ID'), 'client-1');
  await user.type(screen.getByLabelText('Mã bảo mật'), 'secret-1');
}

function setup(route: { status: number; body?: unknown }) {
  const { fetchStub, calls } = stubFetch({ 'POST /integrations/kiotviet/test': route });
  vi.stubGlobal('fetch', fetchStub);
  renderWithProviders(<KiotVietWizard />);
  return { calls, user: userEvent.setup() };
}

describe('wizard credentials step', () => {
  it('shows step 1 of 3 with labelled fields, help text and a hidden, non-autocompleted secret', async () => {
    const { user } = setup({ status: 200, body: TEST_RESPONSE });
    expect(screen.getByText('Bước 1/3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thông tin kết nối' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tên gian hàng')).toHaveAccessibleDescription(
      'Phần trước .kiotviet.vn, ví dụ: shopabc. Dán cả đường link cũng được.',
    );
    const secret = screen.getByLabelText('Mã bảo mật');
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveAttribute('autocomplete', 'off');
    await user.click(screen.getByRole('button', { name: 'Hiện mã bảo mật' }));
    expect(secret).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ẩn mã bảo mật' })).toBeInTheDocument();
  });

  it('requires every field and focuses the first empty one without calling the API', async () => {
    const { user, calls } = setup({ status: 200, body: TEST_RESPONSE });
    await user.type(screen.getByLabelText('Client ID'), 'client-1');
    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    expect(screen.getByText('Nhập tên gian hàng.')).toBeInTheDocument();
    expect(screen.getByText('Nhập mã bảo mật.')).toBeInTheDocument();
    expect(screen.getByLabelText('Tên gian hàng')).toHaveFocus();
    expect(calls).toHaveLength(0);
  });

  it('puts a rejected id/secret under the secret and focuses Client ID', async () => {
    const { user } = setup(rejected('kiotviet_auth'));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    const message =
      'Client ID hoặc mã bảo mật không đúng. Kiểm tra lại trong KiotViet → Thiết lập kết nối API.';
    await waitFor(() => expect(screen.getByLabelText('Client ID')).toHaveFocus());
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(screen.getByLabelText('Client ID')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Mã bảo mật')).toHaveAccessibleDescription(
      expect.stringContaining(message),
    );
    expect(screen.getByText('Bước 1/3')).toBeInTheDocument();
  });

  it('puts an unknown store under the store name and focuses it', async () => {
    const { user } = setup(rejected('kiotviet_retailer'));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    await waitFor(() => expect(screen.getByLabelText('Tên gian hàng')).toHaveFocus());
    expect(
      screen.getByText('Không tìm thấy gian hàng này. Tên gian hàng là phần trước .kiotviet.vn.'),
    ).toBeInTheDocument();
  });

  it('lists missing permissions in a banner', async () => {
    const { user } = setup(rejected('kiotviet_permission', { missing: ['customers', 'orders'] }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tài khoản API chưa được cấp quyền: khách hàng, đặt hàng.',
    );
  });

  it('says KiotViet is busy on 503', async () => {
    const { user } = setup({
      status: 503,
      body: { error: { code: 'UNAVAILABLE', message: 'down' } },
    });
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'KiotViet đang bận, thử lại sau một phút.',
    );
  });

  it('sends the typed credentials and moves to the branches step', async () => {
    const { user, calls } = setup({ status: 200, body: TEST_RESPONSE });
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    expect(await screen.findByText('Bước 2/3')).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({
      retailer: 'https://shopabc.kiotviet.vn/man',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    });
    expect(screen.getByRole('heading', { name: 'Chi nhánh' })).toHaveFocus();
  });

  it('explains where to find the credentials', async () => {
    const { user } = setup({ status: 200, body: TEST_RESPONSE });
    await user.click(screen.getByRole('button', { name: 'Lấy mã ở đâu?' }));
    expect(screen.getByText('Sao chép Client ID và Mã bảo mật dán vào đây.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Xem hướng dẫn của KiotViet' })).toHaveAttribute(
      'href',
      'https://www.kiotviet.vn/huong-dan-su-dung-public-api-retail/',
    );
  });
});
