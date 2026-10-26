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
      {...props}
    />,
  );
  return { ...view, onState };
}

describe('conversation list', () => {
  it('shows the three tabs with the server counts and switches between them', () => {
    const { onState } = renderList();
    const tabs = screen.getAllByRole('tab').filter((tab) => /tabs\./.test(tab.textContent ?? ''));
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'channelInbox.v2.list.tabs.all128',
      'channelInbox.v2.list.tabs.unread12',
      'channelInbox.v2.list.tabs.waiting5',
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tabs[2] as HTMLElement);
    expect(onState).toHaveBeenCalledWith({ tab: 'waiting' });
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
    expect(onState).toHaveBeenCalledWith(DEFAULT_LIST_STATE);
    rerender(<div />);
  });

  it('shows dashes instead of counts while loading', () => {
    renderList({ pending: true, items: [] });
    expect(screen.getAllByText('—')).toHaveLength(3);
  });
});
