import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { BRANCHES, connection, rejected, TEST_RESPONSE } from './fixtures';
import { KiotVietWizard } from './kiotviet-wizard';
import { WizardReviewStep } from './wizard-review-step';

beforeAll(() => loadNamespace('integration'));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
afterEach(() => {
  vi.unstubAllGlobals();
  toasts.success.mockReset();
});

const noop = () => {};

describe('wizard review step', () => {
  it('renders the full preview sentence', () => {
    renderWithProviders(
      <WizardReviewStep
        result={TEST_RESPONSE}
        banner={null}
        starting={false}
        onBack={noop}
        onStart={noop}
      />,
    );
    expect(
      screen.getByText(
        '120 sản phẩm khớp theo mã · 30 sản phẩm mới · 5 sản phẩm chỉ có trên Rapiz (giữ nguyên)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Đẩy đơn sang KiotViet' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Đồng bộ khách hàng' })).toBeChecked();
    expect(screen.getAllByText('Sắp có')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Bắt đầu đồng bộ' })).toBeInTheDocument();
  });

  it('says how much of a large store the preview scanned', () => {
    const preview = { matched: 1200, created: 300, rapizOnly: 9, scanned: 1500, total: 4500 };
    renderWithProviders(
      <WizardReviewStep
        result={{ ...TEST_RESPONSE, preview }}
        banner={null}
        starting={false}
        onBack={noop}
        onStart={noop}
      />,
    );
    expect(
      screen.getByText(
        '1.200 sản phẩm khớp theo mã · 300 sản phẩm mới (trong 1.500/4.500 sản phẩm đầu)',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/chỉ có trên Rapiz/)).toBeNull();
  });
});

describe('wizard start', () => {
  async function toReview(connect: { status: number; body?: unknown }) {
    const routes = {
      'POST /integrations/kiotviet/test': { status: 200, body: TEST_RESPONSE },
      'POST /integrations/kiotviet': connect,
      'GET /integrations': { status: 200, body: { providers: [] } },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<KiotVietWizard />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Tên gian hàng'), 'shopabc');
    await user.type(screen.getByLabelText('Client ID'), 'client-1');
    await user.type(screen.getByLabelText('Mã bảo mật'), 'secret-1');
    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    await user.click(await screen.findByRole('checkbox', { name: BRANCHES[1]!.name }));
    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    await screen.findByText('Bước 3/3');
    return { user, calls };
  }

  it('connects with the chosen branches and the coming-soon switches on', async () => {
    const { user, calls } = await toReview({ status: 201, body: connection() });
    await user.click(screen.getByRole('button', { name: 'Bắt đầu đồng bộ' }));
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(calls.find((c) => c.key === 'POST /integrations/kiotviet')?.body).toEqual({
      retailer: 'shopabc',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      settings: { saleBranchIds: [12], orderBranchId: 12, pushOrders: true, syncCustomers: true },
    });
  });

  it('sends a vanished branch back to the branches step', async () => {
    const { user } = await toReview(rejected('kiotviet_branch', { branchIds: [12] }));
    await user.click(screen.getByRole('button', { name: 'Bắt đầu đồng bộ' }));
    expect(await screen.findByText('Bước 2/3')).toBeInTheDocument();
    expect(
      screen.getByText('Chi nhánh không còn trên KiotViet. Tải lại danh sách và chọn lại.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải lại danh sách' })).toBeInTheDocument();
  });

  it('sends rejected credentials back to step 1', async () => {
    const { user } = await toReview(rejected('kiotviet_auth'));
    await user.click(screen.getByRole('button', { name: 'Bắt đầu đồng bộ' }));
    expect(await screen.findByText('Bước 1/3')).toBeInTheDocument();
    expect(screen.getByLabelText('Client ID')).toHaveFocus();
  });

  it('keeps the step and says KiotViet is busy on 503', async () => {
    const { user } = await toReview({
      status: 503,
      body: { error: { code: 'UNAVAILABLE', message: 'x' } },
    });
    await user.click(screen.getByRole('button', { name: 'Bắt đầu đồng bộ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'KiotViet đang bận, thử lại sau một phút.',
    );
    expect(screen.getByText('Bước 3/3')).toBeInTheDocument();
  });
});
