import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxConversationDto, type InboxConversation } from '../lib/inbox-v2-types';
import { CustomerPanel, CustomerSummary } from './customer-panel';
import { NotesBlock } from './notes-block';

const mocks = vi.hoisted(() => ({ addNote: vi.fn(), can: true }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length ? `${key} ${Object.values(options).join(' ')}` : key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/lib/permissions', () => ({ useCan: () => mocks.can }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../api/inbox', () => ({
  useAddNote: () => ({ mutateAsync: mocks.addNote, isPending: false }),
  useInboxChannels: () => ({
    data: { data: [{ id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01', name: 'Shop Hoa' }] },
  }),
}));
vi.mock('./follow-up-editor', () => ({ FollowUpEditor: () => <div>follow-up editor</div> }));

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
const conv = (patch: Partial<InboxConversation> = {}): InboxConversation => ({ ...base, ...patch });

beforeEach(() => {
  mocks.addNote.mockReset();
  mocks.can = true;
});

describe('notes block', () => {
  const notes = [
    {
      id: 'n1',
      authorId: 'u1',
      authorName: 'Lan',
      text: 'Khách hẹn cuối tuần',
      createdAt: '2026-10-24T08:00:00.000Z',
    },
    {
      id: 'n2',
      authorId: null,
      authorName: '',
      text: 'Ghi chú cũ chuyển sang',
      createdAt: '2026-10-25T09:00:00.000Z',
    },
  ];

  it('lists notes newest first with author, and an unknown author for legacy notes', () => {
    render(<NotesBlock conversation={conv({ notes })} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('channelInbox.v2.panel.noteAuthor');
    expect(items[0]).toHaveTextContent('Ghi chú cũ chuyển sang');
    expect(items[1]).toHaveTextContent('Lan');
  });

  it('adds a note with Enter and clears the field, Shift+Enter keeps writing', async () => {
    const user = userEvent.setup();
    mocks.addNote.mockResolvedValue({});
    render(<NotesBlock conversation={conv({ notes })} />);
    const field = screen.getByRole('textbox');
    await user.type(field, 'Gọi lại 5h{Shift>}{Enter}{/Shift}chiều');
    expect(mocks.addNote).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(mocks.addNote).toHaveBeenCalledWith('Gọi lại 5h\nchiều');
    await waitFor(() => expect(field).toHaveValue(''));
  });

  it('keeps the text when saving fails', async () => {
    const user = userEvent.setup();
    mocks.addNote.mockRejectedValue(new Error('403'));
    render(<NotesBlock conversation={conv()} />);
    const field = screen.getByRole('textbox');
    await user.type(field, 'Quan trọng{Enter}');
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled());
    expect(field).toHaveValue('Quan trọng');
  });

  it('falls back to the old single note when there is no timeline yet', () => {
    render(<NotesBlock conversation={conv({ note: 'Khách quen' })} />);
    expect(screen.getByText('Khách quen')).toBeInTheDocument();
    expect(screen.getByText('channelInbox.v2.panel.legacyNote')).toBeInTheDocument();
  });

  it('shows an empty state and hides the editor without permission', () => {
    mocks.can = false;
    render(<NotesBlock conversation={conv()} />);
    expect(screen.getByText('channelInbox.v2.panel.noteEmpty')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('customer panel', () => {
  it('shows the customer, channel and page and the captured phone, without technical ids', () => {
    render(<CustomerSummary conversation={conv({ customerPhone: '0901234567' })} />);
    expect(screen.getByText('Nguyễn Thu Hà')).toBeInTheDocument();
    expect(screen.getByText('channelInbox.v2.header.via Facebook Shop Hoa')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '0901234567' })).toHaveAttribute(
      'href',
      'tel:0901234567',
    );
    expect(screen.queryByText('2398471234821')).not.toBeInTheDocument();
  });

  it('copies the phone number', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CustomerSummary conversation={conv({ customerPhone: '0901234567' })} />);
    await user.click(screen.getByRole('button', { name: 'channelInbox.sales.copyPhone' }));
    expect(writeText).toHaveBeenCalledWith('0901234567');
  });

  it('asks for no phone when none was captured', () => {
    render(<CustomerSummary conversation={conv()} />);
    expect(screen.getByText('channelInbox.v2.panel.noPhone')).toBeInTheDocument();
  });

  it('collapses blocks, keeps follow-up to one line while empty and opens it for a set reminder', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CustomerPanel conversation={conv()} />);
    expect(screen.getByText('channelInbox.v2.panel.followUpNone')).toBeInTheDocument();
    expect(screen.queryByText('follow-up editor')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /toggle channelInbox.v2.panel.customer/ }));
    expect(screen.queryByText('Nguyễn Thu Hà')).not.toBeInTheDocument();
    unmount();
    render(<CustomerPanel conversation={conv({ followUpAt: '2026-10-26T09:00:00.000Z' })} />);
    expect(screen.getByText('follow-up editor')).toBeInTheDocument();
  });
});
