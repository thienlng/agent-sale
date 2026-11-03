import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithProviders } from '@/testing/render';

import { AdminSidebar } from './admin-sidebar';

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
          <AdminSidebar />
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

describe('AdminSidebar', () => {
  it('lists only platform pages, marks the current one, and leads back to the businesses', async () => {
    renderAt('/admin/payments');
    const nav = await screen.findByRole('navigation', { name: 'Quản trị hệ thống' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/admin/accounts',
      '/admin/payments',
      '/admin/plans',
      '/admin/settings',
      '/admin/llm',
    ]);
    expect(within(nav).getByRole('link', { name: 'Thanh toán' })).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(within(nav).queryByRole('link', { name: 'Thống kê' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Về các business' })).toHaveAttribute(
      'href',
      '/app/overview',
    );
  });
});
