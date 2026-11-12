import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithProviders, renderWithRouter } from '@/testing/render';

import { AccountSidebar } from './account-sidebar';

const session = vi.hoisted(() => ({
  value: {
    user: { id: 'u1', isPlatformAdmin: false },
    workspaceId: null,
    memberships: [
      { workspaceId: 'a', workspaceName: 'Ken Shop', role: 'owner' },
      { workspaceId: 'b', workspaceName: 'Spa Lan', role: 'owner' },
    ],
  },
}));
vi.mock('@/lib/session', () => ({ useSession: () => session.value }));
const owner = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/use-is-account-owner', () => ({ useIsAccountOwner: () => owner.value }));

beforeEach(() => {
  owner.value = false;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

function renderSidebar() {
  return renderWithRouter(() => (
    <TooltipProvider>
      <SidebarProvider>
        <AccountSidebar />
      </SidebarProvider>
    </TooltipProvider>
  ));
}

function renderAt(path: string) {
  const root = createRootRoute({
    component: () => (
      <TooltipProvider>
        <SidebarProvider>
          <AccountSidebar />
        </SidebarProvider>
      </TooltipProvider>
    ),
  });
  const catchAll = createRoute({ getParentRoute: () => root, path: '$', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([catchAll]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderWithProviders(<RouterProvider router={router} />);
}

describe('AccountSidebar', () => {
  it('offers the businesses as one menu entry instead of listing each business', async () => {
    renderSidebar();
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng tài khoản' });
    expect(within(nav).getByRole('link', { name: /Business của tôi/ })).toHaveAttribute(
      'href',
      '/app/businesses',
    );
    expect(within(nav).queryByText('Spa Lan')).toBeNull();
    expect(within(nav).queryByText('Quản trị hệ thống')).toBeNull();
  });

  it('shows the back-office pages directly to a platform admin', async () => {
    session.value = { ...session.value, user: { id: 'u1', isPlatformAdmin: true } };
    renderSidebar();
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng tài khoản' });
    expect(within(nav).getByText('Quản trị hệ thống')).toBeInTheDocument();
    for (const [name, href] of [
      ['Tài khoản', '/admin/accounts'],
      ['Thanh toán', '/admin/payments'],
      ['Gói cước', '/admin/plans'],
      ['Mô hình AI', '/admin/llm'],
    ] as const)
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href);
  });

  it('keeps the account sidebar on a back-office page and marks that page', async () => {
    session.value = { ...session.value, user: { id: 'u1', isPlatformAdmin: true } };
    renderAt('/admin/payments');
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng tài khoản' });
    expect(within(nav).getByRole('link', { name: 'Thanh toán' })).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(within(nav).getByRole('link', { name: 'Tổng quan các business' })).toHaveAttribute(
      'data-active',
      'false',
    );
    expect(within(nav).getByRole('link', { name: /Business của tôi/ })).toBeInTheDocument();
  });

  it('hides the owner assistant from members who do not own the account', async () => {
    renderAt('/app/overview');
    expect(await screen.findByRole('link', { name: 'Tổng quan các business' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Trợ lý' })).toBeNull();
  });

  it('marks the assistant page for an account owner', async () => {
    owner.value = true;
    renderAt('/app/assistant');
    const link = await screen.findByRole('link', { name: 'Trợ lý' });
    expect(link).toHaveAttribute('href', '/app/assistant');
    expect(link).toHaveAttribute('data-active', 'true');
    const links = screen.getAllByRole('link').map((l) => l.textContent);
    expect(links.indexOf('Trợ lý')).toBe(links.indexOf('Tổng quan các business') + 1);
  });
});
