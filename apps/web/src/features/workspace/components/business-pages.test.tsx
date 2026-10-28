import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/lib/session';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { BusinessPicker } from './business-picker';
import { CreateBusinessForm } from './create-business-form';

afterEach(() => vi.unstubAllGlobals());

const X = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';
const Y = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a02';
const B1 = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';
const B2 = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d22';
const B3 = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d23';
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
    {
      workspaceId: B3,
      workspaceName: 'Minh English',
      role: 'sales',
      industry: 'education',
      accountId: Y,
      accountName: 'Minh',
    },
    {
      workspaceId: B2,
      workspaceName: 'Hoa Homestay',
      role: 'owner',
      industry: 'retail',
      accountId: X,
      accountName: 'Hoa Group',
    },
  ],
  workspaceId: null,
  ...over,
});

describe('BusinessPicker', () => {
  it('groups businesses by the account that owns them and chooses one', async () => {
    const onChoose = vi.fn();
    renderWithRouter(() => (
      <BusinessPicker session={session()} lost={false} onChoose={onChoose} onCreate={() => {}} />
    ));
    const hoa = await screen.findByRole('region', { name: 'Hoa Group' });
    expect(
      within(hoa)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([expect.stringContaining('Hoa Fashion'), expect.stringContaining('Hoa Homestay')]);
    const minh = screen.getByRole('region', { name: 'Minh' });
    await userEvent.click(within(minh).getByRole('button', { name: /Minh English/ }));
    expect(onChoose).toHaveBeenCalledWith(B3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says why the user is here after losing a business', async () => {
    renderWithRouter(() => (
      <BusinessPicker session={session()} lost onChoose={() => {}} onCreate={() => {}} />
    ));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bạn không còn quyền truy cập business đó',
    );
  });
});

describe('CreateBusinessForm', () => {
  it('creates the first business without naming an account', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /workspaces': {
        status: 201,
        body: {
          id: B1,
          name: 'Hoa Fashion',
          industry: 'retail',
          timezone: 'Asia/Ho_Chi_Minh',
          createdAt: '2026-10-28T08:00:00.000Z',
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const onCreated = vi.fn();
    renderWithRouter(() => (
      <CreateBusinessForm
        session={session({ accounts: [], memberships: [] })}
        onCreated={onCreated}
      />
    ));
    expect(
      await screen.findByRole('heading', { name: 'Tạo business đầu tiên' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Tên business'), 'Hoa Fashion');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo business' }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(B1));
    expect(calls[0]?.body).toEqual({ name: 'Hoa Fashion', industry: 'retail' });
    expect(calls[0]?.headers['X-Workspace-Id']).toBeUndefined();
  });

  it('asks which account when the user owns several, and reports a failure', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /workspaces': {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'Account not found' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const owned = session({
      accounts: [
        { accountId: X, name: 'Hoa Group', role: 'owner' },
        { accountId: Y, name: 'Hoa Second', role: 'owner' },
      ],
    });
    renderWithRouter(() => (
      <CreateBusinessForm session={owned} onCreated={() => {}} onCancel={() => {}} />
    ));
    expect(await screen.findByRole('heading', { name: 'Tạo business mới' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tài khoản')).toHaveTextContent('Hoa Group');
    await userEvent.type(screen.getByLabelText('Tên business'), 'Hoa Spa');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo business' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tạo business');
    expect(calls[0]?.body).toEqual({ name: 'Hoa Spa', industry: 'retail', accountId: X });
  });
});
