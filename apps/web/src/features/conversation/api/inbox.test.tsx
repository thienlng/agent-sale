import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationTagActions, useInbox } from './inbox';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: mocks.api }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws' }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mocks.api.mockReset();
});

describe('useInbox', () => {
  it('keeps the previous rows and counts while the next filter loads', async () => {
    const first = { data: [], counts: { all: 5, unread: 2, waiting: 1 } };
    mocks.api.mockResolvedValueOnce(first).mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ q }) => useInbox({ q }), {
      wrapper,
      initialProps: { q: '' },
    });
    await waitFor(() => expect(result.current.data).toEqual(first));
    rerender({ q: 'l' });
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toEqual(first);
  });
});

describe('conversation tag actions', () => {
  it('runs two quick attaches one after the other', async () => {
    const releases: Array<() => void> = [];
    mocks.api.mockImplementation(() => new Promise((resolve) => releases.push(() => resolve({}))));
    const { result } = renderHook(() => useConversationTagActions('c1'), { wrapper });
    act(() => {
      result.current.attach.mutate({ id: 'a', name: 'A', color: '#f26b1d' });
      result.current.remove.mutate({ id: 'b', assignmentId: 'as-b' });
    });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api.mock.calls[0]?.[0]).toBe('/conversations/c1/tags');
    await act(async () => releases[0]?.());
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api.mock.calls[1]?.[0]).toBe('/tag-assignments/as-b/remove');
    await act(async () => releases[1]?.());
  });
});
