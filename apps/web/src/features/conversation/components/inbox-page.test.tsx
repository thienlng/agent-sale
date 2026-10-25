import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxCounts, InboxListQuery } from '../lib/inbox-v2-types';
import type { ListState } from '../lib/inbox-list';
import { InboxPage } from './inbox-page';

const fixtures = vi.hoisted(() => ({
  counts: undefined as InboxCounts | undefined,
  queries: [] as InboxListQuery[],
}));
vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { id: 'sale-a' } }) }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'workspace-a' }));
vi.mock('../api/inbox', () => ({
  useInbox: (query: InboxListQuery) => {
    fixtures.queries.push(query);
    return {
      data: { data: [], counts: fixtures.counts },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
  useInboxChannels: () => ({ data: { data: [] } }),
  useInboxTags: () => ({ data: [] }),
  useInboxMembers: () => ({ data: [] }),
}));
vi.mock('./conversation-list', () => ({
  ConversationList: ({
    counts,
    onState,
  }: {
    counts: InboxCounts;
    onState: (patch: Partial<ListState>) => void;
  }) => (
    <div>
      <output aria-label="Counts">{`${counts.all}/${counts.unread}/${counts.waiting}`}</output>
      <button onClick={() => onState({ tab: 'unread', tagsAny: ['tag-a'], assignee: 'me' })}>
        Filter
      </button>
    </div>
  ),
}));
vi.mock('./inbox-empty-state', () => ({ InboxEmptyState: () => null }));
vi.mock('./conversation-view', () => ({ ConversationView: () => null }));

beforeEach(() => {
  fixtures.counts = undefined;
  fixtures.queries = [];
});

describe('inbox page', () => {
  it('passes the server tab counts to the list', () => {
    fixtures.counts = { all: 128, unread: 12, waiting: 5 };
    render(<InboxPage />);
    expect(screen.getByLabelText('Counts')).toHaveTextContent('128/12/5');
  });

  it('falls back to counts derived from the loaded page against an older API', () => {
    render(<InboxPage />);
    expect(screen.getByLabelText('Counts')).toHaveTextContent('0/0/0');
  });

  it('sends the whole filter state to the server and refetches when it changes', () => {
    render(<InboxPage />);
    expect(fixtures.queries.at(-1)).toEqual({ tab: 'all', status: 'open', limit: 100 });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    });
    expect(fixtures.queries.at(-1)).toMatchObject({
      tab: 'unread',
      assignee: 'me',
      tagsAny: 'tag-a',
      status: 'open',
    });
  });
});
