import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as SessionModule from '@/lib/session';
import type { Session } from '@/lib/session';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { CreateBusinessPage } from './create-business-page';

const X = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';
const Y = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a02';
const B1 = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';

let current: Session | null = null;
// Only the session read is replaced; creating and switching keep the real session functions.
vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  useSession: () => current,
}));
afterEach(() => {
  current = null;
  vi.unstubAllGlobals();
});

const session = (over: Partial<Session> = {}): Session => ({
  user: {
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
    email: 'hoa@example.test',
    name: 'Hoa',
    phone: null,
    emailVerified: true,
    locale: 'vi',
    timezone: 'Asia/Ho_Chi_Minh',
    isPlatformAdmin: false,
  },
  accounts: [{ accountId: X, name: 'Hoa Group', role: 'owner' }],
  memberships: [
    {
      workspaceId: B1,
      workspaceName: 'Hoa Fashion',
      role: 'owner',
      industry: 'fashion',
      accountId: X,
      accountName: 'Hoa Group',
    },
  ],
  workspaceId: B1,
  ...over,
});

const WORKSPACE = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
  name: 'Shop Hoa',
  industry: 'retail',
  timezone: 'Asia/Ho_Chi_Minh',
  createdAt: '2026-10-28T00:00:00.000Z',
};

describe('CreateBusinessPage', () => {
  it('creates the business at account level with the chosen name and industry', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /workspaces': { status: 201, body: WORKSPACE },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <CreateBusinessPage />);

    await userEvent.type(await screen.findByLabelText(/tên business/i), '  Shop Hoa ');
    await userEvent.click(screen.getByRole('button', { name: /tạo business/i }));

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.key).toBe('POST /workspaces');
    expect(calls[0]?.body).toEqual({ name: 'Shop Hoa', industry: 'retail' });
    // Creating a business is not scoped to another business.
    expect(calls[0]?.headers['X-Workspace-Id']).toBeUndefined();
  });

  it('shows a clear message when the account may not create more businesses', async () => {
    const { fetchStub } = stubFetch({
      'POST /workspaces': {
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'no' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <CreateBusinessPage />);

    await userEvent.type(await screen.findByLabelText(/tên business/i), 'Shop B');
    await userEvent.click(screen.getByRole('button', { name: /tạo business/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/không được tạo thêm/i);
  });

  it('does nothing for a blank name', async () => {
    const { fetchStub, calls } = stubFetch({});
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <CreateBusinessPage />);

    await userEvent.type(await screen.findByLabelText(/tên business/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /tạo business/i }));
    expect(calls).toHaveLength(0);
  });

  it('welcomes a user without any business (T-079)', async () => {
    current = session({ memberships: [], workspaceId: null });
    renderWithRouter(() => <CreateBusinessPage />);
    expect(
      await screen.findByRole('heading', { name: 'Tạo business đầu tiên' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Tài khoản')).not.toBeInTheDocument();
  });

  it('asks which account when the user owns several, and sends it (ADR-012 §3)', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /workspaces': {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'Account not found' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    current = session({
      accounts: [
        { accountId: X, name: 'Hoa Group', role: 'owner' },
        { accountId: Y, name: 'Hoa Second', role: 'owner' },
      ],
    });
    renderWithRouter(() => <CreateBusinessPage />);
    expect(await screen.findByLabelText('Tài khoản')).toHaveTextContent('Hoa Group');
    await userEvent.type(screen.getByLabelText(/tên business/i), 'Hoa Spa');
    await userEvent.click(screen.getByRole('button', { name: /tạo business/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ name: 'Hoa Spa', industry: 'retail', accountId: X });
  });
});
