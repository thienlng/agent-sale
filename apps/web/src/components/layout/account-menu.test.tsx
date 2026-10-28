import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '@/testing/render';

import { AccountMenu } from './account-menu';

const logout = vi.fn(() => Promise.resolve());

vi.mock('@/lib/session', () => ({
  useSession: () => ({
    user: { id: 'u1', name: 'Nguyễn Thị Lan', email: 'lan.nguyen.very.long.address@example.com' },
    workspaceId: 'w1',
    memberships: [],
  }),
  logout: () => logout(),
}));

async function openMenu() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Tài khoản của Nguyễn Thị Lan' }));
  return { user, menu: await screen.findByRole('menu') };
}

describe('AccountMenu', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    logout.mockClear();
  });

  it('shows who is signed in and a short list of account actions', async () => {
    renderWithRouter(() => <AccountMenu planDialog={() => null} />);
    const { menu } = await openMenu();
    expect(within(menu).getByText('Nguyễn Thị Lan')).toBeInTheDocument();
    expect(within(menu).getByText('lan.nguyen.very.long.address@example.com')).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([
      'Gói và thanh toán',
      'Bảo mật tài khoản',
      'Màn hình và ngôn ngữ',
      'Trang chủ Rapiz (mở tab mới)',
      'Đăng xuất',
    ]);
    // Appearance details are one level deeper, not in the first view.
    expect(within(menu).queryByRole('menuitemradio')).toBeNull();
  });

  it('hides plan and billing when the route supplies no popup', async () => {
    renderWithRouter(() => <AccountMenu />);
    const { menu } = await openMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Gói và thanh toán' })).toBeNull();
  });

  it('opens the plan popup from the menu', async () => {
    renderWithRouter(() => (
      <AccountMenu
        planDialog={({ open }) => (open ? <div role="dialog" aria-label="plan popup" /> : null)}
      />
    ));
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: 'Gói và thanh toán' }));
    expect(await screen.findByRole('dialog', { name: 'plan popup' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('swaps to display settings in place and keeps the menu open while choosing', async () => {
    renderWithRouter(() => <AccountMenu />);
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: /Màn hình và ngôn ngữ/ }));

    const back = within(menu).getByRole('menuitem', { name: /Quay lại/ });
    expect(back).toHaveFocus();
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Tối' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: 'Tối' })).toBeChecked();

    await user.click(back);
    expect(within(menu).getByRole('menuitem', { name: 'Đăng xuất' })).toBeInTheDocument();
  });

  it('keeps layout customisation behind its own dialog', async () => {
    renderWithRouter(() => <AccountMenu />);
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: /Màn hình và ngôn ngữ/ }));
    await user.click(within(menu).getByRole('menuitem', { name: 'Tùy chỉnh bố cục' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tuỳ chỉnh giao diện' });
    expect(within(dialog).getByRole('button', { name: 'Khôi phục mặc định' })).toBeInTheDocument();
  });

  it('goes back one level on Escape before closing', async () => {
    renderWithRouter(() => <AccountMenu />);
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: /Màn hình và ngôn ngữ/ }));
    await user.keyboard('{Escape}');
    expect(within(menu).getByRole('menuitem', { name: 'Đăng xuất' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('returns focus to the avatar when a popup closes, and its reset keeps dark mode', async () => {
    renderWithRouter(() => <AccountMenu />);
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: /Màn hình và ngôn ngữ/ }));
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Tối' }));
    await user.click(within(menu).getByRole('menuitem', { name: 'Tùy chỉnh bố cục' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tuỳ chỉnh giao diện' });
    await user.click(within(dialog).getByRole('button', { name: 'Khôi phục mặc định' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tài khoản của Nguyễn Thị Lan' })).toHaveFocus();
  });

  it('logs out', async () => {
    renderWithRouter(() => <AccountMenu />);
    const { user, menu } = await openMenu();
    await user.click(within(menu).getByRole('menuitem', { name: 'Đăng xuất' }));
    expect(logout).toHaveBeenCalledOnce();
  });
});
