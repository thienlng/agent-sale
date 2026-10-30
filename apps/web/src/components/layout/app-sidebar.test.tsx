import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithProviders } from '@/testing/render';

import { AppSidebar } from './app-sidebar';

vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { isPlatformAdmin: false } }) }));
// The business selector needs a full session; these tests cover the navigation only.
vi.mock('./business-selector', () => ({ BusinessSelector: () => null }));

beforeEach(() => {
  // shadcn's sidebar asks for the mobile breakpoint; jsdom has no matchMedia.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

function renderAt(path: string) {
  const root = createRootRoute({
    component: () => (
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
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

describe('AppSidebar', () => {
  it('shows no coming-soon badge on built pages such as products', async () => {
    renderAt('/app/orders');
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(nav).getByRole('link', { name: 'Sản phẩm' })).toBeVisible();
    expect(within(nav).queryByText('Sắp có')).toBeNull();
  });

  it('lists products as a top-level entry next to orders, not inside the orders section', async () => {
    renderAt('/app/orders');
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });

    const products = within(nav).getByRole('link', { name: 'Sản phẩm' });
    expect(products).toHaveAttribute('href', '/app/products');
    // The orders section is open on /app/orders; its sub-pages must not include products.
    const ordersSection = within(nav).getByRole('button', { name: 'Đơn hàng' }).closest('li');
    expect(ordersSection).not.toBeNull();
    expect(
      within(ordersSection as HTMLElement).getByRole('link', { name: 'Danh sách đơn' }),
    ).toBeVisible();
    expect(
      within(ordersSection as HTMLElement).queryByRole('link', { name: 'Sản phẩm' }),
    ).toBeNull();
  });

  it('marks products active on a product detail page without opening the orders section', async () => {
    renderAt('/app/products/0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01');
    const products = await screen.findByRole('link', { name: 'Sản phẩm' });
    expect(products).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: 'Đơn hàng' })).not.toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.queryByRole('link', { name: 'Danh sách đơn' })).toBeNull();
  });

  it('still opens the orders section with its sub-pages', async () => {
    renderAt('/app/bots');
    await userEvent.click(await screen.findByRole('button', { name: 'Đơn hàng' }));
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute(
      'href',
      '/app/orders/overview',
    );
    expect(screen.getByRole('link', { name: 'Tạo đơn' })).toHaveAttribute(
      'href',
      '/app/orders/new',
    );
  });
});
