import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { ContactConversations } from './contact-conversations';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());

const CONTACT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';
const conversation = (id: string, provider: string, lastMessage: string) => ({
  id,
  channelId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b01',
  provider,
  customerId: 'psid-1',
  customerName: 'Chị Lan',
  mode: 'bot',
  status: 'open',
  assigneeId: null,
  note: '',
  contactId: CONTACT,
  revision: 1,
  lastMessage,
  lastInboundAt: '2026-10-28T08:00:00.000Z',
  updatedAt: '2026-10-28T08:00:00.000Z',
});
const LIST = `GET /conversations?contactId=${CONTACT}&limit=20`;

describe('customer conversations', () => {
  it('lists the conversations linked to the customer, each opening the inbox', async () => {
    const fb = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9c01';
    const ig = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9c02';
    const { fetchStub } = stubFetch({
      [LIST]: {
        status: 200,
        body: {
          data: [
            conversation(fb, 'facebook', 'Còn size M không?'),
            conversation(ig, 'instagram', 'Gửi mình giá nhé'),
          ],
          counts: { all: 2, unread: 0, waiting: 0 },
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ContactConversations contactId={CONTACT} />);
    const first = await screen.findByRole('link', { name: /Còn size M không\?/ });
    expect(first).toHaveAttribute('href', `/app/inbox?conversation=${fb}`);
    expect(screen.getByRole('link', { name: /Gửi mình giá nhé/ })).toHaveTextContent('Instagram');
  });

  it('says so when no conversation is linked', async () => {
    const { fetchStub } = stubFetch({
      [LIST]: { status: 200, body: { data: [], counts: { all: 0, unread: 0, waiting: 0 } } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ContactConversations contactId={CONTACT} />);
    expect(
      await screen.findByText('Chưa có hội thoại nào gắn với khách hàng này.'),
    ).toBeInTheDocument();
  });
});
