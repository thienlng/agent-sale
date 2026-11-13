import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUpdateContact } from './crm';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: mocks.api }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws' }));

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mocks.api.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('useUpdateContact', () => {
  it('reloads the task lists when the status changes, since a confirmed status closes a task (MS3-8)', async () => {
    mocks.api.mockResolvedValue({ id: 'c1' });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateContact('c1'), { wrapper });
    await act(async () => result.current.mutateAsync({ expectedVersion: 1, statusId: 's1' }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ws', 'ws', 'brain'] });
    spy.mockClear();
    await act(async () => result.current.mutateAsync({ expectedVersion: 2, name: 'Hân' }));
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['ws', 'ws', 'brain'] });
  });
});
