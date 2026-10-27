import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIST_STATE, type ListState } from '../lib/inbox-list';
import { InboxConversationDto } from '../lib/inbox-v2-types';
import { ConversationList } from './conversation-list';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

const conversation = InboxConversationDto.parse({
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d00',
  channelId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
  provider: 'facebook',
  customerId: 'psid-1',
  customerName: 'Nguyễn Thu Hà',
  mode: 'bot',
  status: 'open',
  assigneeId: null,
  note: '',
  revision: 1,
  lastMessage: 'Còn hàng không chị',
  lastInboundAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
});

function renderList(props: Partial<React.ComponentProps<typeof ConversationList>> = {}) {
  const onState = vi.fn();
  const view = render(
    <ConversationList
      state={{ ...DEFAULT_LIST_STATE } as ListState}
      searchRef={createRef<HTMLInputElement>()}
      workspaceId="ws"
      userId="user-me"
      onState={onState}
      items={[conversation]}
      channels={[]}
      tags={[]}
      members={[]}
      counts={{ all: 128, unread: 12, waiting: 5 }}
      pending={false}
      error={false}
      onRefetch={vi.fn()}
      hasChannel
      selected={null}
      onSelect={vi.fn()}
      hidden={false}
      now={Date.parse('2026-10-25T10:30:00.000Z')}
      actions={{ onMarkUnread: vi.fn(), onMarkRead: vi.fn(), onAssign: vi.fn() }}
      managing={false}
      onManage={vi.fn()}
      selection={{
        ids: new Set(),
        busy: false,
        onToggle: vi.fn(),
        onSelectAll: vi.fn(),
        onRun: vi.fn(),
        onCancel: vi.fn(),
      }}
      {...props}
    />,
  );
  return { ...view, onState };
}

describe('conversation list', () => {
  it('shows Meta quick filters with server counts; they apply at once and toggle off', () => {
    const { onState, rerender } = renderList();
    const group = screen.getByRole('group', { name: 'channelInbox.meta.quick.label' });
    const quick = Array.from(group.querySelectorAll('button'));
    expect(quick.map((button) => button.textContent)).toEqual([
      'channelInbox.meta.quick.unread12',
      'channelInbox.meta.quick.waiting5',
      'channelInbox.meta.quick.starred',
      'channelInbox.meta.quick.followUp',
    ]);
    expect(quick.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    fireEvent.click(quick[1] as HTMLElement);
    expect(onState).toHaveBeenCalledWith({ tab: 'waiting' });
    fireEvent.click(quick[2] as HTMLElement);
    expect(onState).toHaveBeenCalledWith({ starred: true });
    fireEvent.click(quick[3] as HTMLElement);
    expect(onState).toHaveBeenCalledWith({ followUp: true });
    rerender(<div />);
    renderList({ state: { ...DEFAULT_LIST_STATE, tab: 'waiting', starred: true } });
    const pressed = screen
      .getAllByRole('group', { name: 'channelInbox.meta.quick.label' })
      .at(-1)
      ?.querySelectorAll('[aria-pressed="true"]');
    expect(pressed).toHaveLength(2);
  });

  it('names the folder being viewed and leads back to the inbox', () => {
    const { onState } = renderList({ state: { ...DEFAULT_LIST_STATE, status: 'spam' } });
    expect(
      screen.getByText('channelInbox.meta.folder.viewing channelInbox.meta.folder.spam'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'channelInbox.meta.folder.back' }));
    expect(onState).toHaveBeenCalledWith({ status: 'open' });
  });

  it('ticks rows instead of opening them in manage mode', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    renderList({
      onSelect,
      managing: true,
      selection: {
        ids: new Set([conversation.id]),
        busy: false,
        onToggle,
        onSelectAll: vi.fn(),
        onRun: vi.fn(),
        onCancel: vi.fn(),
      },
    });
    expect(screen.getByRole('toolbar', { name: 'channelInbox.meta.bulk.label' })).toBeVisible();
    expect(screen.getByText('channelInbox.meta.bulk.selected 1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Còn hàng không chị'));
    expect(onToggle).toHaveBeenCalledWith(conversation.id);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('searches through the single search box', () => {
    const { onState } = renderList();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lan' } });
    expect(onState).toHaveBeenCalledWith({ q: 'lan' });
  });

  it('replaces the old stacked filter blocks with one filter button', () => {
    renderList();
    expect(screen.getAllByRole('button', { name: 'channelInbox.v2.list.filter' })).toHaveLength(1);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('lists the conversations and selects one', () => {
    const onSelect = vi.fn();
    renderList({ onSelect });
    fireEvent.click(screen.getByText('Còn hàng không chị'));
    expect(onSelect).toHaveBeenCalledWith(conversation.id);
  });

  it('explains an empty unread tab and offers to clear the filters when filtering', () => {
    const { onState, rerender } = renderList({
      items: [],
      state: { ...DEFAULT_LIST_STATE, tab: 'unread' },
    });
    expect(screen.getByText('channelInbox.v2.list.emptyUnread')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'channelInbox.v2.list.clearAll' }));
    expect(onState).toHaveBeenCalledWith({ ...DEFAULT_LIST_STATE, provider: 'all' });
    rerender(<div />);
  });

  it('shows no counts while loading', () => {
    renderList({ pending: true, items: [] });
    const group = screen.getByRole('group', { name: 'channelInbox.meta.quick.label' });
    expect(group.textContent).not.toMatch(/\d/);
  });

  it('announces the count of the selected queue, never a stale one', () => {
    const { rerender } = renderList({ state: { ...DEFAULT_LIST_STATE, tab: 'unread' } });
    expect(screen.getByText('channelInbox.meta.total 12')).toBeInTheDocument();
    rerender(<div />);
    renderList({ refreshing: true });
    expect(screen.queryByText(/channelInbox\.meta\.total/)).not.toBeInTheDocument();
  });
});
