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
});
