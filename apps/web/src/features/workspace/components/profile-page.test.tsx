import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { ProfilePage } from './profile-page';

const mocks = vi.hoisted(() => ({
  reloadSession: vi.fn(),
  canEdit: true,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/lib/session', () => ({
  reloadSession: mocks.reloadSession,
  useSession: () => ({ workspaceId: 'ws-1', memberships: [] }),
}));
vi.mock('@/lib/permissions', () => ({ useCan: () => mocks.canEdit }));

const profile = {
  name: 'Ken Shop',
  companyName: '',
  businessServices: 'legacy services text',
  productDescription: 'legacy description text',
  hasLogo: false,
  logoVersion: null,
  version: 4,
  updatedAt: '2026-10-29T00:00:00.000Z',
};
const workspace = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
  name: 'Ken Shop',
  industry: 'hotel',
  timezone: 'Asia/Ho_Chi_Minh',
  createdAt: '2026-10-27T00:00:00.000Z',
};

beforeEach(() => {
  mocks.canEdit = true;
  mocks.reloadSession.mockReset().mockResolvedValue({});
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function setup(extra: Record<string, { status: number; body?: unknown }> = {}) {
  const stub = stubFetch({
    'GET /workspace/profile': { status: 200, body: profile },
    'GET /workspaces/current': { status: 200, body: workspace },
    ...extra,
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => <ProfilePage />);
  return stub;
}

describe('business information page', () => {
  it('has one editable name, a read-only template summary and no services/description fields', async () => {
    setup();
    expect(await screen.findByLabelText('Tên business')).toHaveValue('Ken Shop');
    expect(screen.getAllByLabelText('Tên business')).toHaveLength(1);
    expect(screen.queryByLabelText(/Lĩnh vực \/ dịch vụ/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Mô tả sản phẩm/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('legacy services text')).not.toBeInTheDocument();
    expect(await screen.findByText('Khách sạn / homestay')).toBeInTheDocument();
    expect(screen.getByText('Loại hình')).toBeInTheDocument();
    // The template is a summary, not a control.
    expect(screen.queryByDisplayValue('Khách sạn / homestay')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Lưu thay đổi' })).toHaveLength(1);
  });

  it('points to the bot business information and keeps the company name collapsed', async () => {
    setup();
    await screen.findByLabelText('Tên business');
    expect(screen.getByRole('link', { name: 'Mở danh sách bot' })).toHaveAttribute(
      'href',
      '/app/bots',
    );
    expect(screen.queryByLabelText('Tên công ty (không bắt buộc)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thông tin công ty' }));
    expect(screen.getByLabelText('Tên công ty (không bắt buộc)')).toBeInTheDocument();
  });

  it('saves a rename with the version, then refreshes the business labels everywhere', async () => {
    const stub = setup({
      'PATCH /workspace/profile': {
        status: 200,
        body: { ...profile, name: 'Villas', version: 5 },
      },
    });
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Tên business');
    await screen.findByText('Khách sạn / homestay');
    await user.clear(name);
    await user.type(name, 'Villas');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.reloadSession).toHaveBeenCalledTimes(1));
    const patch = stub.calls.find((c) => c.key === 'PATCH /workspace/profile');
    expect(patch?.body).toMatchObject({ name: 'Villas', expectedVersion: 4 });
    expect(patch?.body).not.toHaveProperty('businessServices');
    expect(patch?.body).not.toHaveProperty('productDescription');
    await waitFor(() =>
      expect(stub.calls.filter((c) => c.key === 'GET /workspaces/current')).toHaveLength(2),
    );
  });

  it('shows the conflict message and keeps the draft on a stale save', async () => {
    setup({
      'PATCH /workspace/profile': {
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'stale' } },
      },
    });
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Tên business');
    await user.type(name, ' 2');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        expect.stringContaining('vừa được người khác sửa'),
      ),
    );
    expect(name).toHaveValue('Ken Shop 2');
    expect(mocks.reloadSession).not.toHaveBeenCalled();
  });

  it('is read-only without the manage permission', async () => {
    mocks.canEdit = false;
    setup();
    expect(await screen.findByLabelText('Tên business')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).not.toBeInTheDocument();
  });
});
