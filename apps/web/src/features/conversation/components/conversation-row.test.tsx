import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InboxConversationDto, type InboxConversation } from '../lib/inbox-v2-types';
import { ConversationRow, type RowActions } from './conversation-row';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));
vi.mock('@tanstack/react-router', () => ({ Link: () => null }));

const NOW = Date.parse('2026-10-25T10:30:00.000Z');
const base = InboxConversationDto.parse({
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d00',
  channelId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
  provider: 'facebook',
  customerId: '2398471234821',
  customerName: 'Nguyễn Thu Hà',
  mode: 'bot',
  status: 'open',
  assigneeId: null,
  note: '',
  revision: 1,
  lastMessage: 'Chị ơi son này còn không',
  lastInboundAt: '2026-10-25T10:18:00.000Z',
  updatedAt: '2026-10-25T10:18:00.000Z',
});
const members = [
  { userId: 'user-me', name: 'Minh' },
  { userId: 'user-lan', name: 'Lan' },
];
const actions = (): RowActions => ({
  onMarkUnread: vi.fn(),
  onMarkRead: vi.fn(),
  onAssign: vi.fn(),
});

function renderRow(patch: Partial<InboxConversation> = {}, rowActions = actions()) {
  const view = render(
    <ul>
      <ConversationRow
        conversation={{ ...base, ...patch }}
        active={false}
        onSelect={vi.fn()}
        now={NOW}
        members={members}
        userId="user-me"
        actions={rowActions}
      />
    </ul>,
  );
  return { ...view, actions: rowActions };
}

describe('conversation row', () => {
  it('shows the customer name, preview and who answers', () => {
    renderRow();
    expect(screen.getByText('Nguyễn Thu Hà')).toBeInTheDocument();
    expect(screen.getByText('Chị ơi son này còn không')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'channelInbox.v2.row.modeBot' })).toBeInTheDocument();
  });

  it('never shows the raw channel id as the name', () => {
    renderRow({ customerName: '2398471234821' });
    expect(screen.getByText('channelInbox.v2.row.guest Facebook 4821')).toBeInTheDocument();
    expect(screen.queryByText('2398471234821')).not.toBeInTheDocument();
  });

  it('marks an unread conversation with a bold name and the unread count', () => {
    renderRow({ unreadCount: 2 });
    expect(screen.getByText('Nguyễn Thu Hà').className).toContain('font-bold');
    expect(
      screen.getByRole('img', { name: 'channelInbox.v2.row.unreadBadge 2' }),
    ).toHaveTextContent('2');
  });

  it('keeps a read conversation regular weight without a badge', () => {
    renderRow();
    expect(screen.getByText('Nguyễn Thu Hà').className).not.toContain('font-bold');
    expect(screen.queryByRole('img', { name: /unreadBadge/ })).not.toBeInTheDocument();
  });

  it('shows the wait time, red only after 15 minutes', () => {
    const { unmount } = renderRow({ awaitingSince: '2026-10-25T10:18:00.000Z' });
    const calm = screen.getByLabelText('channelInbox.v2.row.waited channelInbox.v2.row.wait.m 12');
    expect(calm).toHaveTextContent('channelInbox.v2.row.wait.m 12');
    expect(calm).not.toHaveAttribute('data-urgent');
    unmount();
    renderRow({ awaitingSince: '2026-10-25T10:10:00.000Z' });
    expect(
      screen.getByLabelText('channelInbox.v2.row.waited channelInbox.v2.row.wait.m 20'),
    ).toHaveAttribute('data-urgent', 'true');
  });

  it('shows no wait time when nobody is waiting', () => {
    renderRow();
    expect(screen.queryByLabelText(/row.waited/)).not.toBeInTheDocument();
  });

  it('prefixes the preview when the shop or the bot spoke last', () => {
    const { unmount } = renderRow({ lastMessageSender: 'human' });
    expect(screen.getByText(/^channelInbox\.v2\.row\.humanPrefix/)).toBeInTheDocument();
    unmount();
    renderRow({ lastMessageSender: 'bot' });
    expect(screen.getByText(/^channelInbox\.v2\.row\.botPrefix/)).toBeInTheDocument();
  });

  it('shows up to three tags in their colour plus a +N counter', () => {
    const tags = ['VIP', 'Hỏi giá', 'Đã cọc', 'Ship gấp', 'Khó tính'].map((name, i) => ({
      id: `tag-${i}`,
      name,
      color: '#f26b1d',
    }));
    renderRow({ tags });
    for (const name of ['VIP', 'Hỏi giá', 'Đã cọc'])
      expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByText('Ship gấp')).not.toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows a phone icon only when a number was captured', () => {
    const { unmount } = renderRow({ customerPhone: '0901234567' });
    expect(screen.getByRole('img', { name: 'channelInbox.v2.row.phone' })).toBeInTheDocument();
    unmount();
    renderRow();
    expect(
      screen.queryByRole('img', { name: 'channelInbox.v2.row.phone' }),
    ).not.toBeInTheDocument();
  });

  it('shows the assignee before the name and the human mode icon', () => {
    renderRow({ assigneeId: 'user-lan', mode: 'human' });
    const badge = screen.getByRole('img', { name: 'channelInbox.v2.row.assignedTo Lan' });
    expect(badge).toHaveTextContent('L');
    expect(screen.getByRole('img', { name: 'channelInbox.v2.row.modeHuman' })).toBeInTheDocument();
  });

  it('marks a read conversation unread from the row menu', async () => {
    const user = userEvent.setup();
    const { actions: a } = renderRow();
    await user.click(screen.getByRole('button', { name: 'channelInbox.v2.row.menu' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'channelInbox.v2.row.markUnread' }),
    );
    expect(a.onMarkUnread).toHaveBeenCalledWith(base.id);
  });

  it('offers mark read for an unread conversation and opens on right click', async () => {
    const user = userEvent.setup();
    const { actions: a } = renderRow({ unreadCount: 3 });
    fireEvent.contextMenu(screen.getByRole('listitem'));
    await user.click(await screen.findByRole('menuitem', { name: 'channelInbox.v2.row.markRead' }));
    expect(a.onMarkRead).toHaveBeenCalledWith(base.id);
  });

  it('assigns the conversation to me, to a member or to nobody', async () => {
    const user = userEvent.setup();
    const { actions: a } = renderRow({ assigneeId: 'user-lan' });
    await user.click(screen.getByRole('button', { name: 'channelInbox.v2.row.menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'channelInbox.v2.row.assign' }));
    const sub = within(await screen.findByRole('menu', { name: 'channelInbox.v2.row.assign' }));
    sub.getByRole('menuitem', { name: 'channelInbox.v2.row.assignMe' }).focus();
    await user.keyboard('{Enter}');
    expect(a.onAssign).toHaveBeenCalledWith(base.id, 'user-me');
  });
});
