import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';
import { getSession, login } from '@/lib/session';
import { renderWithRouter } from '@/testing/render';

import { NavUser } from './nav-user';

const X = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';
const Y = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a02';
const B1 = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';
const B2 = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d22';
const B3 = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d23';
const user = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
  email: 'hoa@example.test',
  name: 'Hoa Tran',
  phone: null,
  emailVerified: true,
  locale: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  isPlatformAdmin: false,
};
const membership = (
  workspaceId: string,
  workspaceName: string,
  accountId: string,
  accountName: string,
) => ({
  workspaceId,
  workspaceName,
  role: 'owner',
  industry: 'retail',
  accountId,
  accountName,
});

afterEach(() => vi.unstubAllGlobals());

describe('NavUser', () => {
  it('switches business from the avatar menu, grouped by account', async () => {
    localStorage.clear();
    localStorage.setItem('rapiz.workspace', B1);
    vi.stubGlobal(
      'fetch',
      async (input: string) =>
        new Response(
          JSON.stringify(
            input.endsWith('/bootstrap')
              ? {
                  user,
                  accounts: [{ accountId: X, name: 'Hoa Group', role: 'owner' }],
                  memberships: [
                    membership(B1, 'Hoa Fashion', X, 'Hoa Group'),
                    membership(B3, 'Minh English', Y, 'Minh'),
                    membership(B2, 'Hoa Homestay', X, 'Hoa Group'),
                  ],
                }
              : { user, accessToken: 'test-token', expiresIn: 900 },
          ),
        ),
    );
    await login({ email: user.email, password: 'test' });
    renderWithRouter(() => (
      <SidebarProvider>
        <NavUser />
      </SidebarProvider>
    ));
    await userEvent.click(await screen.findByRole('button', { name: /Hoa Tran/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Chuyển business' }));
    const menu = (await screen.findAllByRole('menu')).at(-1)!;
    const groups = within(menu).getAllByRole('group');
    expect(
      groups.map((g) =>
        within(g)
          .getAllByRole('menuitem')
          .map((i) => i.textContent),
      ),
    ).toEqual([['Hoa Fashion', 'Hoa Homestay'], ['Minh English']]);
    expect(within(groups[0]!).getByText('Hoa Group')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Hoa Fashion' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Tạo business' })).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Minh English' }));
    await vi.waitFor(() => expect(getSession()?.workspaceId).toBe(B3));
  });
});
