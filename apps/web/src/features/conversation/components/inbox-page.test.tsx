import type { ConversationDto } from '@agent-sales/contracts';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboxPage } from './inbox-page';

const fixtures = vi.hoisted(() => ({ items: [] as ConversationDto[] }));
vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { id: 'sale-a' } }) }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'workspace-a' }));
vi.mock('../api/inbox', () => ({
  useInbox: () => ({
    data: { data: fixtures.items },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useInboxChannels: () => ({ data: { data: [] } }),
}));
vi.mock('./conversation-list', () => ({
  ConversationList: ({ queueCounts }: { queueCounts: Record<string, number> }) => (
    <output aria-label="Due count">{queueCounts.due}</output>
  ),
}));
vi.mock('./inbox-empty-state', () => ({ InboxEmptyState: () => null }));
vi.mock('./conversation-view', () => ({ ConversationView: () => null }));

afterEach(() => {
  vi.useRealTimers();
});

describe('inbox due clock', () => {
  it('refreshes due counts every minute without a message or network update', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-25T10:00:00.000Z');
    fixtures.items = [
      {
        id: 'conversation-a',
        channelId: 'page-a',
        provider: 'facebook',
        customerId: 'customer-a',
        customerName: 'Customer A',
        mode: 'human',
        autoResumeAt: null,
        status: 'open',
        assigneeId: null,
        note: '',
        revision: 1,
        lastMessage: 'Hello',
        lastInboundAt: '2026-10-25T09:00:00.000Z',
        updatedAt: '2026-10-25T09:00:00.000Z',
        followUpAt: '2026-10-25T10:00:30.000Z',
      },
    ];
    const view = render(<InboxPage />);
    expect(screen.getByLabelText('Due count')).toHaveTextContent('0');
    act(() => {
      vi.advanceTimersByTime(59999);
    });
    expect(screen.getByLabelText('Due count')).toHaveTextContent('0');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByLabelText('Due count')).toHaveTextContent('1');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
