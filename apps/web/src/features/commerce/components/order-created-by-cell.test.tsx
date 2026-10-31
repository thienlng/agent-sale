import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { formatDateTime } from '@/lib/format';
import { renderWithProviders } from '@/testing/render';

import { OrderCreatedByCell, type OrderOrigin } from './order-created-by-cell';

const CONVERSATION = '4f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const staff: OrderOrigin = {
  createdByKind: 'agent',
  createdByName: 'Ngọc Anh',
  reviewState: null,
  reviewedByName: null,
  reviewedAt: null,
  conversationId: null,
};
const botPending: OrderOrigin = {
  ...staff,
  createdByKind: 'bot',
  createdByName: null,
  reviewState: 'pending',
  conversationId: CONVERSATION,
};
const botApproved: OrderOrigin = {
  ...botPending,
  reviewState: 'approved',
  reviewedByName: 'Thu Hà',
  reviewedAt: '2026-10-31T09:15:00.000Z',
};

/** The cell inside a clickable "row", like the orders table. */
function renderCell(order: OrderOrigin) {
  const onRow = vi.fn();
  renderWithProviders(
    <TooltipProvider>
      <div onClick={onRow}>
        <OrderCreatedByCell order={order} />
      </div>
    </TooltipProvider>,
  );
  return onRow;
}

// jsdom cannot open a new tab: cancel the default action (capture phase, so React still sees it).
const noNavigation = (e: Event) => e.preventDefault();
beforeEach(() => window.addEventListener('click', noNavigation, true));
afterEach(() => window.removeEventListener('click', noNavigation, true));

describe('OrderCreatedByCell ("Người tạo")', () => {
  it('shows the staff name for a staff order, with no bot badge or conversation link', () => {
    renderCell(staff);
    expect(screen.getByText('Ngọc Anh')).toBeInTheDocument();
    expect(screen.queryByText('Bot')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows Bot, the "Chờ duyệt" chip and the new-tab conversation link for a pending bot order', () => {
    renderCell(botPending);
    expect(screen.getByText('Bot')).toBeInTheDocument();
    expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Mở cuộc trò chuyện ở tab mới' });
    expect(link).toHaveAttribute('href', `/app/inbox?conversation=${CONVERSATION}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows "Đã duyệt" with who approved it and when, also on keyboard focus', async () => {
    renderCell(botApproved);
    expect(screen.getByText('Bot')).toBeInTheDocument();
    expect(screen.queryByText('Chờ duyệt')).toBeNull();
    await userEvent.setup().tab();
    expect(screen.getByText('Đã duyệt').closest('[tabindex]')).toHaveFocus();
    const tip = `Duyệt bởi Thu Hà · ${formatDateTime('2026-10-31T09:15:00.000Z')}`;
    expect((await screen.findAllByText(tip)).length).toBeGreaterThan(0);
  });

  it('opens the conversation without also opening the order (the row click)', async () => {
    const onRow = renderCell(botPending);
    await userEvent.setup().click(screen.getByRole('link'));
    expect(onRow).not.toHaveBeenCalled();
  });

  it('hides the conversation link when the order has no conversation', () => {
    renderCell({ ...botPending, conversationId: null });
    expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
