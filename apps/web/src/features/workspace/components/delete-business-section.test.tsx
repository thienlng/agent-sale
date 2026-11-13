import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { DeleteBusinessSection } from './delete-business-section';

const WS = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b02';
const role = vi.hoisted(() => ({ value: 'owner' }));
const reloadSession = vi.hoisted(() => vi.fn(async () => null));
const navigate = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/session', () => ({
  reloadSession,
  useSession: () => ({
    user: { id: 'u1' },
    workspaceId: WS,
    accounts: [],
    memberships: [
      {
        workspaceId: WS,
        workspaceName: 'Tiệm Hoa Mai',
        role: role.value,
        industry: 'retail',
        accountId: 'own',
        createdAt: '2026-10-01T00:00:00Z',
      },
    ],
  }),
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<object>()),
  useNavigate: () => navigate,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  role.value = 'owner';
});

const DELETED = {
  workspaceId: WS,
  name: 'Tiệm Hoa Mai',
  industry: 'retail',
  icon: 'building',
  deletedAt: '2026-11-12T03:00:00.000Z',
  purgeAfter: '2026-12-12T03:00:00.000Z',
};

function setup(answer: { status: number; body?: unknown }) {
  const stub = stubFetch({
    [`POST /workspaces/${WS}/deletion`]: answer,
    'GET /workspaces/deleted': { status: 200, body: { data: [] } },
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => <DeleteBusinessSection />);
  return stub.calls;
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Xoá business…' }));
  return user;
}

describe('DeleteBusinessSection', () => {
  it('explains what stops, links to the export and asks the owner to type the name', async () => {
    setup({ status: 200, body: DELETED });
    expect(await screen.findByText('Bot ngừng trả lời khách trên mọi kênh.')).toBeInTheDocument();
    expect(screen.getByText('Chăm sóc tự động và Business Brain dừng lại.')).toBeInTheDocument();
    expect(screen.getByText(/Trang Facebook, Instagram và chat website/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xuất dữ liệu' })).toHaveAttribute(
      'href',
      '/app/settings/data',
    );
    const user = await openDialog();
    expect(screen.getByRole('heading', { name: 'Xoá business Tiệm Hoa Mai?' })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Xoá business' });
    expect(submit).toBeDisabled();
    await user.click(screen.getByLabelText('Nhập tên business để xác nhận'));
    await user.paste('tiệm hoa mai');
    expect(submit).toBeDisabled();
  });

  it('deletes after the exact name, then goes to the business list and reloads the session', async () => {
    const calls = setup({ status: 200, body: DELETED });
    const user = await openDialog();
    await user.click(screen.getByLabelText('Nhập tên business để xác nhận'));
    await user.paste('Tiệm Hoa Mai');
    await user.click(screen.getByRole('button', { name: 'Xoá business' }));
    await waitFor(() => expect(reloadSession).toHaveBeenCalled());
    expect(calls.find((c) => c.key === `POST /workspaces/${WS}/deletion`)?.body).toEqual({
      confirmName: 'Tiệm Hoa Mai',
    });
    const headers = calls.find((c) => c.key === `POST /workspaces/${WS}/deletion`)?.headers ?? {};
    expect(Object.keys(headers).filter((k) => /workspace/i.test(k))).toEqual([]);
    expect(navigate).toHaveBeenCalledWith({ to: '/app/businesses', search: {} });
    expect(navigate.mock.invocationCallOrder[0]).toBeLessThan(
      reloadSession.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('shows the refusal when the server says the name does not match', async () => {
    setup({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Type the business name exactly to delete it',
          details: { field: 'confirmName', reason: 'name_mismatch' },
        },
      },
    });
    const user = await openDialog();
    await user.click(screen.getByLabelText('Nhập tên business để xác nhận'));
    await user.paste('Tiệm Hoa Mai');
    await user.click(screen.getByRole('button', { name: 'Xoá business' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tên chưa khớp. Nhập đúng tên business.',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('copies the exact name and accepts it typed with decomposed accents', async () => {
    setup({ status: 200, body: DELETED });
    const user = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Chép tên Tiệm Hoa Mai' }));
    expect(await navigator.clipboard.readText()).toBe('Tiệm Hoa Mai');
    await user.click(screen.getByLabelText('Nhập tên business để xác nhận'));
    await user.paste('Tiệm Hoa Mai'.normalize('NFD'));
    expect(screen.getByRole('button', { name: 'Xoá business' })).toBeEnabled();
  });

  it('tells a member who is not the owner that only the owner can delete', async () => {
    role.value = 'admin';
    setup({ status: 403 });
    expect(
      await screen.findByText('Chỉ chủ business mới xoá được business này.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xoá business…' })).toBeNull();
  });
});
