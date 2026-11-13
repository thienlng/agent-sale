import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageFixture } from '@/testing/assistant-factories';

import { useSendAssistantMessage, withoutRetriedAttempt } from './assistant';
import { importKeys } from './imports';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: mocks.api }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws' }));

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient();
  mocks.api.mockReset();
});

const TURN = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';

describe('useSendAssistantMessage', () => {
  it('marks every cached import batch stale after a turn (a turn may preview again)', async () => {
    mocks.api.mockResolvedValue({ messages: [], run: { id: 'run-1' } });
    const batchKey = importKeys.batch('ws', 'batch-1');
    client.setQueryData(batchKey, { id: 'batch-1' });
    const { result } = renderHook(() => useSendAssistantMessage(), { wrapper });
    await act(() => result.current.mutateAsync({ threadId: 'thread-1', turnId: TURN, text: 'hi' }));
    expect(client.getQueryState(batchKey)?.isInvalidated).toBe(true);
  });
});

describe('withoutRetriedAttempt (AS-1)', () => {
  const question = messageFixture({ id: 'q', role: 'user', content: 'doanh thu', runId: 'r1' });
  const busy = messageFixture({ id: 'a', content: 'bận', runId: 'r1', retryable: true });

  it('drops the busy reply and its question when the same text is sent again', () => {
    expect(withoutRetriedAttempt([question, busy], 'doanh thu')).toEqual([]);
  });

  it('keeps them for another text or an answer that is not a busy reply', () => {
    expect(withoutRetriedAttempt([question, busy], 'khác')).toHaveLength(2);
    const answered = { ...busy, retryable: undefined };
    expect(withoutRetriedAttempt([question, answered], 'doanh thu')).toHaveLength(2);
  });
});
