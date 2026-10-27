import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InboxMessage } from '../lib/inbox-v2-types';
import { sharedImages, SharedImagesBlock } from './panel-sections';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const message = (id: string, attachments: { type: string; url: string }[]) =>
  InboxMessage.parse({
    id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d${id}`,
    conversationId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d99',
    direction: 'inbound',
    sender: 'customer',
    text: '',
    attachments,
    status: 'received',
    failureCode: null,
    externalId: null,
    createdAt: '2026-10-25T10:00:00.000Z',
  });

describe('shared images', () => {
  it('lists pictures newest first, once each, and ignores other files', () => {
    const messages = [
      message('01', [{ type: 'image', url: 'https://cdn.test/a.jpg' }]),
      message('02', [{ type: 'file', url: 'https://cdn.test/b.pdf' }]),
      message('03', [
        { type: 'image', url: 'https://cdn.test/c.jpg' },
        { type: 'image', url: 'https://cdn.test/a.jpg' },
      ]),
    ];
    expect(sharedImages(messages)).toEqual(['https://cdn.test/c.jpg', 'https://cdn.test/a.jpg']);
  });

  it('says the grid only covers the loaded messages', () => {
    render(
      <SharedImagesBlock
        messages={[message('01', [{ type: 'image', url: 'https://cdn.test/a.jpg' }])]}
      />,
    );
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByText('channelInbox.meta.panel.loadedOnly')).toBeInTheDocument();
  });

  it('shows an empty state without pictures', () => {
    render(<SharedImagesBlock messages={[]} />);
    expect(screen.getAllByText('channelInbox.meta.panel.noImages').length).toBeGreaterThan(0);
  });
});
