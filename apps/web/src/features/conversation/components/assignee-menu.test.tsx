import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssigneeMenu } from './assignee-menu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));
const members = [
  { userId: 'user-me', name: 'Minh' },
  { userId: 'user-lan', name: 'Lan' },
  { userId: 'user-hung', name: 'Hùng' },
];
const A = 'channelInbox.v2.header.assignee.';
function renderMenu(assigneeId: string | null) {
  const onAssign = vi.fn();
  render(
    <AssigneeMenu
      assigneeId={assigneeId}
      members={members}
      loading={false}
      userId="user-me"
      disabled={false}
      onAssign={onAssign}
    />,
  );
  return onAssign;
}

describe('assignee menu', () => {
  it('shows "Chưa giao" when nobody owns the conversation', () => {
    renderMenu(null);
    expect(screen.getByRole('button', { name: `${A}label ${A}none` })).toBeInTheDocument();
  });

  it('shows the owner name', () => {
    renderMenu('user-lan');
    expect(screen.getByRole('button', { name: `${A}label Lan` })).toBeInTheDocument();
  });

  it('assigns any member found through search', async () => {
    const user = userEvent.setup();
    const onAssign = renderMenu(null);
    await user.click(screen.getByRole('button'));
    await user.type(await screen.findByPlaceholderText(`${A}search`), 'hù');
    expect(screen.queryByText('Lan')).not.toBeInTheDocument();
    await user.click(screen.getByText('Hùng'));
    expect(onAssign).toHaveBeenCalledWith('user-hung');
  });

  it('assigns to me in one click', async () => {
    const user = userEvent.setup();
    const onAssign = renderMenu(null);
    await user.click(screen.getByRole('button'));
    await user.click(await screen.findByText(`${A}me`));
    expect(onAssign).toHaveBeenCalledWith('user-me');
  });

  it('removes the assignee, and only offers that when someone is assigned', async () => {
    const user = userEvent.setup();
    const onAssign = renderMenu('user-lan');
    await user.click(screen.getByRole('button'));
    await user.click(await screen.findByText(`${A}unassign`));
    expect(onAssign).toHaveBeenCalledWith(null);
  });

  it('does not call back when the current owner is picked again', async () => {
    const user = userEvent.setup();
    const onAssign = renderMenu('user-lan');
    await user.click(screen.getByRole('button'));
    await user.click(await screen.findByRole('option', { name: 'Lan' }));
    expect(onAssign).not.toHaveBeenCalled();
  });
});
