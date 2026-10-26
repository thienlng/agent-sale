import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIST_STATE, type ListState } from '../lib/inbox-list';
import { InboxFilterChips } from './inbox-filter-chips';
import { InboxFilterPopover } from './inbox-filter-popover';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));

const tags = [
  { id: 'tag-vip', name: 'VIP', color: '#f26b1d' },
  { id: 'tag-price', name: 'Hỏi giá', color: '#2563eb' },
];
const members = [{ userId: 'user-lan', name: 'Lan' }];
const channels = [{ id: 'page-1', name: 'Shop Hoa', provider: 'facebook' as const }];

function Harness({
  initial = {},
  spy,
}: {
  initial?: Partial<ListState>;
  spy?: (s: ListState) => void;
}) {
  const [state, setState] = useState<ListState>({ ...DEFAULT_LIST_STATE, ...initial });
  const patch = (p: Partial<ListState>) =>
    setState((prev) => {
      const next = { ...prev, ...p };
      spy?.(next);
      return next;
    });
  return (
    <>
      <InboxFilterPopover
        state={state}
        onState={patch}
        tags={tags}
        members={members}
        channels={channels}
      />
      <InboxFilterChips
        state={state}
        onState={patch}
        tags={tags}
        members={members}
        channels={channels}
      />
    </>
  );
}

describe('inbox filter popover', () => {
  it('shows the number of active groups on the single filter button', () => {
    render(<Harness initial={{ tagsAny: ['tag-vip'], tagsExclude: ['tag-price'], mode: 'bot' }} />);
    const button = screen.getByRole('button', { name: /channelInbox\.v2\.list\.filterActive 2/ });
    expect(button).toHaveTextContent('2');
  });

  it('lists the groups on the left and the options of the chosen group on the right', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'channelInbox.v2.list.filter' }));
    const groups = within(
      screen.getByRole('tablist', { name: 'channelInbox.v2.filter.groupsLabel' }),
    );
    expect(groups.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'channelInbox.v2.filter.groups.tags',
      'channelInbox.v2.filter.groups.waiting',
      'channelInbox.v2.filter.groups.mode',
      'channelInbox.v2.filter.groups.assignee',
      'channelInbox.v2.filter.groups.channel',
      'channelInbox.v2.filter.groups.phone',
      'channelInbox.v2.filter.groups.status',
    ]);
    await user.click(groups.getByRole('tab', { name: 'channelInbox.v2.filter.groups.waiting' }));
    await user.click(screen.getByRole('radio', { name: 'channelInbox.v2.filter.waiting.longest' }));
    expect(
      screen.getByRole('radio', { name: 'channelInbox.v2.filter.waiting.longest' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('button', {
        name: 'channelInbox.v2.list.removeChip channelInbox.v2.filter.waiting.longest',
      }),
    ).toBeInTheDocument();
  });

  it('filters tags as has-any, has-all, exclude or untagged', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await user.click(screen.getByRole('button', { name: 'channelInbox.v2.list.filter' }));
    await user.click(screen.getByRole('checkbox', { name: 'VIP' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ tagsAny: ['tag-vip'] }));
    await user.click(screen.getByRole('radio', { name: 'channelInbox.v2.filter.tagsExclude' }));
    await user.click(screen.getByRole('checkbox', { name: 'Hỏi giá' }));
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ tagsAny: ['tag-vip'], tagsExclude: ['tag-price'] }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'channelInbox.v2.filter.untagged' }));
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ untagged: true, tagsAny: [], tagsAll: [], tagsExclude: [] }),
    );
  });

  it('picks assignee, channel, phone and status', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await user.click(screen.getByRole('button', { name: 'channelInbox.v2.list.filter' }));
    const open = (group: string) =>
      user.click(screen.getByRole('tab', { name: `channelInbox.v2.filter.groups.${group}` }));
    await open('assignee');
    await user.click(screen.getByRole('radio', { name: 'Lan' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: 'user-lan' }));
    await open('channel');
    await user.click(screen.getByRole('radio', { name: 'Shop Hoa' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: 'page-1' }));
    await open('phone');
    await user.click(screen.getByRole('radio', { name: 'channelInbox.v2.filter.phone.yes' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ hasPhone: 'yes' }));
    await open('status');
    await user.click(screen.getByRole('radio', { name: 'channelInbox.v2.filter.status.resolved' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'resolved' }));
  });

  it('resets every filter but keeps the search text and tab', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={{ q: 'lan', tab: 'unread', mode: 'bot' }} spy={spy} />);
    await user.click(screen.getByRole('button', { name: /filterActive/ }));
    await user.click(screen.getByRole('button', { name: 'channelInbox.v2.filter.reset' }));
    expect(spy).toHaveBeenLastCalledWith({ ...DEFAULT_LIST_STATE, q: 'lan', tab: 'unread' });
  });
});

describe('inbox filter chips', () => {
  it('shows one removable chip per active value on a scrolling line', () => {
    const spy = vi.fn();
    render(
      <Harness
        initial={{
          tagsAny: ['tag-vip'],
          assignee: 'user-lan',
          channelId: 'page-1',
          hasPhone: 'no',
        }}
        spy={spy}
      />,
    );
    const list = screen.getByRole('list', { name: 'channelInbox.v2.list.chipsLabel' });
    expect(list.className).toContain('overflow-x-auto');
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'channelInbox.v2.list.removeChip channelInbox.v2.chip.tagsAny VIP',
      }),
    );
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ tagsAny: [] }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /removeChip Lan/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /removeChip Shop Hoa/ })).toBeInTheDocument();
  });

  it('renders nothing without active filters', () => {
    render(<Harness />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('never keeps one tag in both "has" and "exclude"', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} initial={{ tagsExclude: ['tag-vip'], tagsAll: ['tag-price'] }} />);
    await user.click(screen.getByRole('button', { name: /filterActive/ }));
    await user.click(screen.getByRole('checkbox', { name: 'VIP' }));
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ tagsAny: ['tag-vip'], tagsExclude: [] }),
    );
    await user.click(screen.getByRole('radio', { name: 'channelInbox.v2.filter.tagsExclude' }));
    await user.click(screen.getByRole('checkbox', { name: 'VIP' }));
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ tagsAny: [], tagsAll: ['tag-price'], tagsExclude: ['tag-vip'] }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Hỏi giá' }));
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ tagsAll: [], tagsExclude: ['tag-vip', 'tag-price'] }),
    );
  });

  it('offers only the longest-waiting and read-not-replied options besides "all"', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'channelInbox.v2.list.filter' }));
    await user.click(screen.getByRole('tab', { name: 'channelInbox.v2.filter.groups.waiting' }));
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'channelInbox.v2.filter.waiting.off',
      'channelInbox.v2.filter.waiting.longest',
      'channelInbox.v2.filter.waiting.readNotReplied',
    ]);
  });
});
