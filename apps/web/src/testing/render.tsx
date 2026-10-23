import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

import { Providers } from '@/app/providers';

/** Render with app providers (i18n, query). */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options });
}

/** Render a component that uses <Link>/navigation, inside a throwaway in-memory router. */
export function renderWithRouter(ui: () => ReactElement) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/', component: ui });
  const catchAll = createRoute({ getParentRoute: () => root, path: '$', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, catchAll]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return renderWithProviders(<RouterProvider router={router} />);
}

/** A fetch stub answering by "METHOD /path" with JSON bodies; records every call. */
export function stubFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: Array<{ key: string; body: unknown; headers: Record<string, string> }> = [];
  const fetchStub = async (input: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${input.replace('/api/v1', '')}`;
    calls.push({
      key,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchStub, calls };
}
