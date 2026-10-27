import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InboxConversationDto, type InboxConversation } from '../lib/inbox-v2-types';
import { ConversationHeader } from './conversation-header';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));

const NOW = new Date(2026, 9, 25, 15).getTime();
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
  lastMessage: 'Xin chào',
  lastInboundAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
});
const V = 'channelInbox.v2.header.';

function renderHeader(
  patch: Partial<InboxConversation> = {},
  channel: { name: string; externalId: string } | { canEdit: boolean } = {
    name: 'Shop Hoa',
    externalId: '777',
  },
) {
  const canEdit = 'canEdit' in channel ? channel.canEdit : true;
  const page = 'canEdit' in channel ? { name: 'Shop Hoa', externalId: '777' } : channel;
  const handlers = {
    onChange: vi.fn(),
    onMarkUnread: vi.fn(),
    onToggleSearch: vi.fn(),
    onToggleDetails: vi.fn(),
    onBack: vi.fn(),
  };
  render(
    <ConversationHeader
      conversation={{ ...base, ...patch }}
      channel={page}
      canEdit={canEdit}
      botAvailable
      takeoverMinutes={5}
      members={[{ userId: 'user-lan', name: 'Lan' }]}
      membersLoading={false}
      userId="user-me"
      busy={false}
      now={NOW}
      detailsOpen={false}
      {...handlers}
    />,
  );
  return handlers;
}

describe('conversation header', () => {
  it('shows the customer name with the channel and page', () => {
    renderHeader();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      `Nguyễn Thu Hà${V}via Facebook Shop Hoa`,
    );
  });

  it('shows who else saw the conversation and when', () => {
    renderHeader({
      lastReadAt: new Date(2026, 9, 25, 14, 5).toISOString(),
      lastReadBy: { userId: 'user-lan', name: 'Lan' },
    });
    expect(screen.getByText(`${V}seenBy Lan 14:05`)).toBeInTheDocument();
  });

  it('shows nothing when the viewer read it last and nothing is new', () => {
    renderHeader({
      lastReadAt: new Date(2026, 9, 25, 14, 5).toISOString(),
      lastReadBy: { userId: 'user-me', name: 'Minh' },
    });
    expect(screen.queryByText(/seenBy|unseen/)).not.toBeInTheDocument();
  });

  it('flags new messages nobody has seen in the brand colour', () => {
    renderHeader({
      unreadCount: 2,
      lastReadAt: new Date(2026, 9, 25, 14, 5).toISOString(),
      lastReadBy: { userId: 'user-lan', name: 'Lan' },
    });
    expect(screen.getByText(`${V}unseen`).className).toContain('text-primary');
    expect(screen.queryByText(/seenBy/)).not.toBeInTheDocument();
  });

  it('marks the conversation done and reopens it', async () => {
    const user = userEvent.setup();
    const open = renderHeader();
    await user.click(screen.getByRole('button', { name: `${V}resolve` }));
    expect(open.onChange).toHaveBeenCalledWith({ status: 'resolved' });
  });

  it('reopens a finished conversation', async () => {
    const user = userEvent.setup();
    const done = renderHeader({ status: 'resolved' });
    await user.click(screen.getByRole('button', { name: `${V}reopen` }));
    expect(done.onChange).toHaveBeenCalledWith({ status: 'open' });
  });

  it('assigns the conversation from the header dropdown', async () => {
    const user = userEvent.setup();
    const h = renderHeader({ mode: 'human' });
    await user.click(screen.getByRole('button', { name: /assignee\.label/ }));
    await user.click(await screen.findByText('Lan'));
    expect(h.onChange).toHaveBeenCalledWith({ assigneeId: 'user-lan' });
  });

  it('marks unread from its icon and searches from the more menu', async () => {
    const user = userEvent.setup();
    const h = renderHeader();
    await user.click(screen.getByRole('button', { name: `${V}markUnread` }));
    expect(h.onMarkUnread).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: `${V}more` }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'channelInbox.sales.searchThread' }),
    );
    expect(h.onToggleSearch).toHaveBeenCalled();
  });

  it('links to the Facebook inbox of the page, only when a link exists', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole('button', { name: `${V}more` }));
    const link = await screen.findByRole('menuitem', { name: `${V}openOn Facebook` });
    expect(link).toHaveAttribute(
      'href',
      'https://business.facebook.com/latest/inbox/all?asset_id=777',
    );
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('offers no external link for Instagram', async () => {
    const user = userEvent.setup();
    renderHeader({ provider: 'instagram' });
    await user.click(screen.getByRole('button', { name: `${V}more` }));
    await screen.findByRole('menuitem', { name: 'channelInbox.sales.searchThread' });
    expect(screen.queryByRole('menuitem', { name: /openOn/ })).not.toBeInTheDocument();
  });

  it('moves to Spam and back, as a pressed toggle', async () => {
    const user = userEvent.setup();
    const h = renderHeader();
    const spam = screen.getByRole('button', { name: 'channelInbox.meta.header.spam' });
    expect(spam).toHaveAttribute('aria-pressed', 'false');
    await user.click(spam);
    expect(h.onChange).toHaveBeenCalledWith({ status: 'spam' });
  });

  it('restores a spam conversation to the inbox', async () => {
    const user = userEvent.setup();
    const h = renderHeader({ status: 'spam' });
    const restore = screen.getByRole('button', { name: 'channelInbox.meta.header.notSpam' });
    expect(restore).toHaveAttribute('aria-pressed', 'true');
    await user.click(restore);
    expect(h.onChange).toHaveBeenCalledWith({ status: 'open' });
  });

  it('stars and unstars without touching the folder', async () => {
    const user = userEvent.setup();
    const h = renderHeader();
    await user.click(screen.getByRole('button', { name: 'channelInbox.meta.header.star' }));
    expect(h.onChange).toHaveBeenCalledWith({ starred: true });
  });

  it('disables every control change without permission to edit', () => {
    renderHeader({}, { canEdit: false });
    for (const name of [`${V}markUnread`, `${V}resolve`, 'channelInbox.meta.header.spam'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
  });
});
