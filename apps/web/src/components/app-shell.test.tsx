import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';

import { renderWithProviders, renderWithRouter } from '@/testing/render';

import { AppShell } from './app-shell';

vi.mock('@/lib/session', () => ({ useSession: () => null }));
vi.mock('./layout/app-sidebar', () => ({ AppSidebar: () => <nav>sidebar</nav> }));
vi.mock('./layout/account-menu', () => ({ AccountMenu: () => <button>account</button> }));

describe('AppShell', () => {
  it('renders the header actions before the account menu', async () => {
    renderWithRouter(() => (
      <AppShell headerActions={<button>bell</button>}>
        <p>page</p>
      </AppShell>
    ));
    const bell = await screen.findByRole('button', { name: 'bell' });
    const account = screen.getByRole('button', { name: 'account' });
    expect(bell.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  it('names the catalog section for the courses or services of an education or spa business', async () => {
    function at(path: string, industry: string) {
      const root = createRootRoute();
      const page = createRoute({
        getParentRoute: () => root,
        path: '$',
        component: () => (
          <AppShell industry={industry}>
            <p>page</p>
          </AppShell>
        ),
      });
      const router = createRouter({
        routeTree: root.addChildren([page]),
        history: createMemoryHistory({ initialEntries: [path] }),
      });
      return renderWithProviders(<RouterProvider router={router} />);
    }
    const header = async () => {
      await screen.findByText('page');
      return document.querySelector('header');
    };
    let view = at('/app/products/new', 'education');
    expect(await header()).toHaveTextContent('Khoá học');
    view.unmount();
    view = at('/app/products', 'spa');
    expect(await header()).toHaveTextContent('Dịch vụ');
    view.unmount();
    at('/app/products', 'retail');
    expect(await header()).toHaveTextContent('Sản phẩm');
  });
});
