import type { InboxMessageDto } from '@agent-sales/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageThread } from './message-thread';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('./message-attachments', () => ({ MessageAttachments: () => null }));
const message = (id: string): InboxMessageDto => ({
  id,
  conversationId: 'conversation',
  direction: 'inbound',
  sender: 'customer',
  text: id,
  attachments: [],
  status: 'received',
  failureCode: null,
  externalId: null,
  createdAt: '2026-10-25T10:00:00.000Z',
});

describe('MessageThread', () => {
  it('preserves the reading position when new messages arrive and offers an explicit jump', () => {
    const view = render(<MessageThread messages={[message('first')]} />);
    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    view.rerender(<MessageThread messages={[message('first'), message('second')]} />);
    expect(log.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: 'channelInbox.sales.newMessages' }));
    expect(log.scrollTop).toBe(1000);
    expect(
      screen.queryByRole('button', { name: 'channelInbox.sales.newMessages' }),
    ).not.toBeInTheDocument();
  });
  it('detects new arrivals in a capped message window without relying on its length', () => {
    const initial = Array.from({ length: 200 }, (_, i) => message(`message-${i}`));
    const view = render(<MessageThread messages={initial} />);
    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    view.rerender(<MessageThread messages={[...initial.slice(1), message('message-200')]} />);
    expect(log.scrollTop).toBe(100);
    expect(
      screen.getByRole('button', { name: 'channelInbox.sales.newMessages' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'channelInbox.sales.newMessages' }));
    view.rerender(
      <MessageThread
        messages={[...initial.slice(2), message('message-200'), message('message-201')]}
      />,
    );
    expect(log.scrollTop).toBe(1000);
  });

  it('puts a "Tin mới" divider before the first customer message after the last read time', () => {
    const at = (id: string, createdAt: string, extra: Partial<InboxMessageDto> = {}) => ({
      ...message(id),
      createdAt,
      ...extra,
    });
    render(
      <MessageThread
        newAfter="2026-10-25T10:00:00.000Z"
        messages={[
          at('old', '2026-10-25T09:00:00.000Z'),
          at('reply', '2026-10-25T10:05:00.000Z', { direction: 'outbound', sender: 'human' }),
          at('new-1', '2026-10-25T10:10:00.000Z'),
          at('new-2', '2026-10-25T10:11:00.000Z'),
        ]}
      />,
    );
    const separators = screen.getAllByRole('separator');
    expect(separators).toHaveLength(1);
    expect(separators[0]).toHaveTextContent('channelInbox.v2.thread.newDivider');
    expect(separators[0]?.nextElementSibling).toHaveTextContent('new-1');
  });

  it('shows no divider when nothing arrived after the last read', () => {
    render(<MessageThread newAfter="2026-10-26T00:00:00.000Z" messages={[message('a')]} />);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    render(<MessageThread messages={[message('b')]} />);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('labels bot messages "Bot"', () => {
    render(
      <MessageThread
        messages={[
          { ...message('bot-1'), direction: 'outbound', sender: 'bot', status: 'sent' },
          { ...message('human-1'), direction: 'outbound', sender: 'human', status: 'sent' },
        ]}
      />,
    );
    expect(screen.getAllByText('channelInbox.v2.thread.bot')).toHaveLength(1);
  });

  it('places the divider before the last N customer messages when the conversation was marked unread', () => {
    const inbound = (id: string, minute: number) => ({
      ...message(id),
      createdAt: `2026-10-25T10:0${minute}:00.000Z`,
    });
    render(
      <MessageThread
        newUnread={2}
        messages={[
          inbound('a', 1),
          { ...inbound('mine', 2), direction: 'outbound', sender: 'human' },
          inbound('b', 3),
          inbound('c', 4),
        ]}
      />,
    );
    expect(screen.getByRole('separator').nextElementSibling).toHaveTextContent('b');
  });

  it('shows the staff name on human replies and falls back to the generic label', () => {
    const human = (id: string, senderName?: string | null) => ({
      ...message(id),
      direction: 'outbound' as const,
      sender: 'human' as const,
      status: 'sent' as const,
      senderName,
    });
    render(<MessageThread messages={[human('one', 'Lan'), human('two'), human('three', ' ')]} />);
    expect(screen.getByText(/· Lan$/)).toBeInTheDocument();
    expect(screen.getAllByText(/· channelInbox\.humanSent$/)).toHaveLength(2);
  });
});
