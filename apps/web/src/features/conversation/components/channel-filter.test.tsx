import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChannelFilter } from './channel-filter';

const page = (id: string, name: string, provider: 'facebook' | 'instagram') =>
  ({ id, name, provider, status: 'connected' }) as ChannelConnectionDto;

describe('channel filter', () => {
  it('filters by channel and lists channels that are not connectable yet as disabled', async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    render(
      <ChannelFilter
        state={{ provider: 'all', channelId: 'all' }}
        onState={onState}
        channels={[page('p1', 'Shop Hoa', 'facebook')]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /channelInbox.inbox.channelFilter/ }));
    expect(
      screen.getByRole('menuitem', { name: /channelInbox.inbox.channels.zalo/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    await user.click(
      screen.getByRole('menuitem', { name: 'channelInbox.inbox.channels.instagram' }),
    );
    expect(onState).toHaveBeenCalledWith({ provider: 'instagram', channelId: 'all' });
  });

  it('offers each page when a channel has several', async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    render(
      <ChannelFilter
        state={{ provider: 'all', channelId: 'all' }}
        onState={onState}
        channels={[page('p1', 'Shop Hoa', 'facebook'), page('p2', 'Shop Lá', 'facebook')]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /channelInbox.inbox.channelFilter/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Shop Lá' }));
    expect(onState).toHaveBeenCalledWith({ provider: 'all', channelId: 'p2' });
  });
});
