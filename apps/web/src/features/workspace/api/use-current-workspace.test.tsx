import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { setWorkspaceId } from '@/lib/api-client';
import { useCurrentWorkspace } from './use-current-workspace';

const a = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';
const b = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d22';
vi.mock('@/lib/use-workspace', () => ({
  useWorkspaceId: () => '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21',
}));
afterEach(() => {
  vi.unstubAllGlobals();
  setWorkspaceId(null);
});

it('keeps a delayed query retry on its original business and forwards cancellation', async () => {
  const scopes: Array<string | undefined> = [];
  const signals: Array<AbortSignal | null | undefined> = [];
  setWorkspaceId(a);
  vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
    const scope = (init.headers as Record<string, string>)['X-Workspace-Id'];
    scopes.push(scope);
    signals.push(init.signal);
    if (scopes.length === 1) {
      setWorkspaceId(b);
      return new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Retry' } }), {
        status: 503,
      });
    }
    return new Response(
      JSON.stringify({
        id: scope,
        name: 'Business A',
        industry: 'hotel',
        createdAt: '2026-10-28T00:00:00.000Z',
      }),
      { status: 200 },
    );
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCurrentWorkspace(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(scopes).toEqual([a, a]);
  expect(signals.every((signal) => signal !== undefined && signal !== null)).toBe(true);
  expect(result.current.data?.id).toBe(a);
  client.clear();
});
