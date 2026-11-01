import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETRY_REFRESH_MS, useRetryOrderPush } from './integrations';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: mocks.api }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws' }));

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient();
  mocks.api.mockReset();
});
afterEach(() => vi.useRealTimers());

const ordersRefreshes = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(
    ([filters]) =>
      JSON.stringify((filters as { queryKey?: unknown } | undefined)?.queryKey) ===
      '["ws","ws","orders"]',
  ).length;

describe('"Thử lại" (useRetryOrderPush)', () => {
  it('reads the orders again right away, then after the push had time to run', async () => {
    mocks.api.mockResolvedValue(null);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRetryOrderPush(), { wrapper });
    await act(() => result.current.mutateAsync('order-1'));
    expect(mocks.api.mock.calls[0]?.[0]).toBe('/integrations/kiotviet/orders/order-1/push');
    expect(ordersRefreshes(spy)).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(RETRY_REFRESH_MS[0]));
    expect(ordersRefreshes(spy)).toBe(2);
    await act(() => vi.advanceTimersByTimeAsync(RETRY_REFRESH_MS[1] - RETRY_REFRESH_MS[0]));
    expect(ordersRefreshes(spy)).toBe(3);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(ordersRefreshes(spy)).toBe(3);
  });

  it('does not keep polling after a refused retry', async () => {
    mocks.api.mockRejectedValue(new Error('409'));
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRetryOrderPush(), { wrapper });
    await act(() => result.current.mutateAsync('order-1').catch(() => undefined));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(ordersRefreshes(spy)).toBe(1);
  });
});
