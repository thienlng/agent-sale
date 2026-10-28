import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxCounts, InboxListQuery } from '../lib/inbox-v2-types';
import type { ReactNode } from 'react';
import type { ListState } from '../lib/inbox-list';
import type { ListSelection } from './conversation-list';
import { InboxPage } from './inbox-page';

const fixtures = vi.hoisted(() => ({
  counts: undefined as InboxCounts | undefined,
  queries: [] as InboxListQuery[],
  rows: [] as { id: string; channelId: string; status: string; mode: string; provider: string }[],
  bulk: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { id: 'sale-a' } }) }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'workspace-a' }));
vi.mock('../api/inbox', () => ({
  useInbox: (query: InboxListQuery) => {
    fixtures.queries.push(query);
    return {
      data: { data: fixtures.rows, counts: fixtures.counts },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
  useInboxChannels: () => ({ data: { data: [] } }),
  useInboxTags: () => ({ data: [] }),
  useInboxMembers: () => ({ data: [] }),
  useReadState: () => ({ markRead: { mutate: vi.fn() }, markUnread: { mutate: vi.fn() } }),
  useAssignConversation: () => ({ mutate: vi.fn() }),
  useBulkConversations: () => ({ mutate: fixtures.bulk, isPending: false }),
  // A deep-linked conversation is looked up by id, whatever the list shows.
  useConversation: (id: string | null) => ({
    data: id ? { conversation: { id, channelId: 'page-9' } } : undefined,
  }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('./conversation-list', () => ({
  ConversationList: ({
    counts,
    now,
    onState,
    managing,
    onManage,
    selection,
  }: {
    counts: InboxCounts;
    now: number;
    onState: (patch: Partial<ListState>) => void;
    managing: boolean;
    onManage: () => void;
    selection: ListSelection;
  }) => (
    <div>
      <output aria-label="Selected">{managing ? [...selection.ids].join(',') : 'off'}</output>
      <button onClick={onManage}>Manage</button>
      <button onClick={() => selection.onSelectAll(true)}>All</button>
      <button onClick={() => selection.onToggle('b')}>Toggle b</button>
      <button onClick={() => selection.onRun({ action: 'star' })}>Star</button>
      <output aria-label="Now">{now}</output>
      <output aria-label="Counts">{`${counts.all}/${counts.unread}/${counts.waiting}`}</output>
      <button onClick={() => onState({ q: 'lan' })}>Type</button>
      <button onClick={() => onState({ tab: 'unread', tagsAny: ['tag-a'], assignee: 'me' })}>
        Filter
      </button>
    </div>
  ),
}));
vi.mock('./inbox-empty-state', () => ({ InboxEmptyState: () => null }));
vi.mock('./conversation-view', () => ({
  ConversationView: ({ id, onBack }: { id: string; onBack: () => void }) => (
    <div>
      <output aria-label="Open conversation">{id}</output>
      <button onClick={onBack}>Close conversation</button>
    </div>
  ),
}));
vi.mock('./comments-entry', () => ({ CommentsEntry: () => <p>Comments entry</p> }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  fixtures.counts = undefined;
  fixtures.queries = [];
  fixtures.rows = [];
  fixtures.bulk.mockReset();
});
const row = (id: string) => ({
  id,
  channelId: 'page-1',
  status: 'open',
  mode: 'bot',
  provider: 'facebook',
});

describe('inbox page', () => {
  it('opens a deep-linked conversation that the list does not show, once', () => {
    render(<InboxPage openConversationId="conv-far" />);
    expect(screen.getByLabelText('Open conversation')).toHaveTextContent('conv-far');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    });
    expect(screen.queryByLabelText('Open conversation')).toBeNull();
  });

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

  it('advances the clock every minute so wait times refresh without a network update', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-25T10:00:00.000Z');
    const view = render(<InboxPage />);
    const start = Date.parse('2026-10-25T10:00:00.000Z');
    expect(screen.getByLabelText('Now')).toHaveTextContent(String(start));
    act(() => {
      vi.advanceTimersByTime(59999);
    });
    expect(screen.getByLabelText('Now')).toHaveTextContent(String(start));
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByLabelText('Now')).toHaveTextContent(String(start + 60000));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks the server once typing pauses, not on every keystroke', () => {
    vi.useFakeTimers();
    render(<InboxPage />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    });
    expect(fixtures.queries.every((q) => q.q === undefined)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(fixtures.queries.every((q) => q.q === undefined)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fixtures.queries.at(-1)).toMatchObject({ q: 'lan' });
  });

  it('filters by the channel tab and shows the comments entry instead of a fake list', () => {
    render(<InboxPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'channelInbox.meta.tabs.facebook' }));
    expect(fixtures.queries.at(-1)).toMatchObject({ provider: 'facebook' });
    fireEvent.click(screen.getByRole('tab', { name: 'channelInbox.meta.tabs.fbComments' }));
    expect(screen.getByText('Comments entry')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument();
    // WhatsApp is not a tab: nothing behind it can be opened.
    expect(screen.queryByRole('tab', { name: /whatsapp/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'channelInbox.meta.tabs.all' }));
    expect(fixtures.queries.at(-1)?.provider).toBeUndefined();
  });

  it('selects only visible rows, clears the selection when the list changes', () => {
    fixtures.rows = [row('a'), row('b')];
    render(<InboxPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByLabelText('Selected')).toHaveTextContent('a,b');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle b' }));
    expect(screen.getByLabelText('Selected')).toHaveTextContent(/^a$/);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByLabelText('Selected')).toHaveTextContent(/^$/);
  });

  it('keeps only the failed ids selected after a partial failure, so retry repeats those', () => {
    fixtures.rows = [row('a'), row('b')];
    fixtures.bulk.mockImplementation((_body, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({
        data: [
          { id: 'a', ok: true, code: null },
          { id: 'b', ok: false, code: 'NOT_FOUND' },
        ],
        succeeded: 1,
        failed: 1,
      }),
    );
    render(<InboxPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Star' }));
    expect(fixtures.bulk.mock.calls[0]?.[0]).toEqual({ action: 'star', ids: ['a', 'b'] });
    expect(screen.getByLabelText('Selected')).toHaveTextContent(/^b$/);
    fireEvent.click(screen.getByRole('button', { name: 'Star' }));
    expect(fixtures.bulk.mock.calls[1]?.[0]).toEqual({ action: 'star', ids: ['b'] });
  });
});
