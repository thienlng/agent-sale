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
import { loadNamespace } from '@/lib/i18n';

// Routes load the lodging namespace before rendering; tests render the pages directly.
await loadNamespace('lodging');

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

type StubAnswer = { status: number; body?: unknown };

/**
 * Like `stubFetch`, but a route may answer a list: each call takes the next answer and the last
 * one repeats (e.g. a 403 `reauth_required`, then the success after the step-up).
 */
export function stubFetchSequence(routes: Record<string, StubAnswer | StubAnswer[]>) {
  const seen: Record<string, number> = {};
  const flat: Record<string, StubAnswer> = {};
  const stub = stubFetch(
    new Proxy(flat, {
      get: (_, key: string) => {
        const answer = routes[key];
        if (!Array.isArray(answer)) return answer;
        const index = Math.min(seen[key] ?? 0, answer.length - 1);
        seen[key] = (seen[key] ?? 0) + 1;
        return answer[index];
      },
    }),
  );
  return stub;
}

/** A step-up state (GET/POST /auth/reauth) for tests. */
export function stepUpStatus(
  overrides: Partial<{
    methods: Array<'totp' | 'password' | 'email' | 'google'>;
    recent: boolean;
    mfa: boolean;
    recentUntil: string | null;
    hasPassword: boolean;
  }> = {},
) {
  return {
    methods: ['password'],
    recent: false,
    mfa: false,
    recentUntil: null,
    hasPassword: true,
    ...overrides,
  };
}
