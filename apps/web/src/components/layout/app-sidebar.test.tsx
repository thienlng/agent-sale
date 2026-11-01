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

const denied = vi.hoisted(() => new Set<string>());
vi.mock('@/lib/permissions', () => ({ useCan: (capability: string) => !denied.has(capability) }));
vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { isPlatformAdmin: false } }) }));
// The business selector needs a full session; these tests cover the navigation only.
vi.mock('./business-selector', () => ({ BusinessSelector: () => null }));

beforeEach(() => {
  denied.clear();
  // shadcn's sidebar asks for the mobile breakpoint; jsdom has no matchMedia.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

function renderAt(
  path: string,
  industry: 'hotel' | 'saas' | 'retail' | 'loading' = 'retail',
  navCounts?: Record<string, { count: number; label: string }>,
) {
  const root = createRootRoute({
    component: () => (
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar
            industry={industry === 'loading' ? undefined : industry}
            navCounts={navCounts}
          />
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
  it('shows placeholders, not retail entries, while the industry is still loading', async () => {
    renderAt('/app/calendar', 'loading');
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(nav).getByTestId('industry-nav-loading')).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Sản phẩm' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Đơn hàng' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Lịch' })).toBeNull();
  });

  it('uses lodging navigation for a hotel without retail stock or shipping orders', async () => {
    renderAt('/app/calendar', 'hotel');
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(nav).getByRole('link', { name: 'Lịch' })).toHaveAttribute(
      'href',
      '/app/calendar',
    );
    expect(within(nav).getByRole('link', { name: 'Booking' })).toHaveAttribute(
      'href',
      '/app/bookings',
    );
    expect(within(nav).getByRole('link', { name: 'Căn hộ' })).toHaveAttribute(
      'href',
      '/app/properties',
    );
    expect(within(nav).queryByRole('link', { name: 'Sản phẩm' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Đơn hàng' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: /Căn lưu trú|Yêu cầu đặt căn/ })).toBeNull();
  });

  it('shows a waiting count next to an entry, with a spoken label', async () => {
    renderAt('/app/calendar', 'hotel', {
      '/app/bookings': { count: 3, label: '3 giữ chỗ của bot chờ xử lý' },
    });
    const booking = await screen.findByRole('link', { name: 'Booking' });
    const item = booking.closest('li') as HTMLElement;
    expect(within(item).getByText('3')).toBeVisible();
    expect(within(item).getByText('3 giữ chỗ của bot chờ xử lý')).toHaveClass('sr-only');
  });

  it('hides a zero count', async () => {
    renderAt('/app/calendar', 'hotel', {
      '/app/bookings': { count: 0, label: '0 giữ chỗ của bot chờ xử lý' },
    });
    const booking = await screen.findByRole('link', { name: 'Booking' });
    expect(within(booking.closest('li') as HTMLElement).queryByText('0')).toBeNull();
  });

  it('marks Căn hộ active on a property detail page', async () => {
    renderAt('/app/properties/0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01', 'hotel');
    const properties = await screen.findByRole('link', { name: 'Căn hộ' });
    expect(properties).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: 'Lịch' })).not.toHaveAttribute('data-active', 'true');
  });

  it('keeps a SaaS business on one customer list, without orders and products', async () => {
    renderAt('/app/contacts', 'saas');
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    const links = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .filter((h) => /^\/app\/(contacts|saas-)/.test(h ?? ''));
    expect(links).toEqual(['/app/contacts']);
    expect(within(nav).queryByRole('link', { name: 'Sản phẩm' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Đơn hàng' })).toBeNull();
  });

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

  it('lists "Tích hợp PMS" right after products', async () => {
    renderAt('/app/bots');
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    const links = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    const pms = within(nav).getByRole('link', { name: 'Tích hợp PMS' });
    expect(pms).toHaveAttribute('href', '/app/integrations');
    expect(links.indexOf('Tích hợp PMS')).toBe(links.indexOf('Sản phẩm') + 1);
    // Still being proven with real shops: the item says so.
    expect(pms.closest('li')).toHaveTextContent('Thử nghiệm');
  });

  it('puts "Tích hợp PMS" after the platform integrations for a hotel', async () => {
    renderAt('/app/bots', 'hotel');
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    const links = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(links.indexOf('Tích hợp PMS')).toBe(links.indexOf('Tích hợp nền tảng') + 1);
  });

  it('hides "Tích hợp PMS" from members who cannot manage the catalog', async () => {
    denied.add('catalog.manage');
    renderAt('/app/bots');
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(nav).queryByRole('link', { name: 'Tích hợp PMS' })).toBeNull();
  });
});
