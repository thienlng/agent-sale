import type { EntitlementsDto } from '@agent-sales/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { PlanDialog } from './plan-dialog';

const refetch = vi.fn();
let state: { data?: EntitlementsDto; isError?: boolean } = {};

vi.mock('../api/use-entitlements', () => ({
  useEntitlements: () => ({ ...state, refetch }),
}));

const PRO: EntitlementsDto = {
  plan: { code: 'pro', name: 'Pro', version: 1 },
  status: 'trialing',
  periodEnd: '2026-11-28T00:00:00.000Z',
  limits: { 'members.max': 5, 'channels.max': null, 'storage.bytes': 1000 },
  features: {},
  aiModels: ['smart'],
  aiIncludedMessages: { amount: 7000, periodDays: 30 },
};

describe('PlanDialog', () => {
  beforeEach(() => {
    state = {};
    refetch.mockClear();
  });

  it('shows the plan, its status and what it includes', () => {
    state = { data: PRO };
    renderWithProviders(<PlanDialog open onOpenChange={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Gói và thanh toán' });
    expect(within(dialog).getByText('Pro')).toBeInTheDocument();
    expect(within(dialog).getByText('Dùng thử')).toBeInTheDocument();
    expect(within(dialog).getByText(/Dùng thử đến 28\/11\/2026/)).toBeInTheDocument();
    expect(within(dialog).getByText('7.000 tin / 30 ngày')).toBeInTheDocument();
    expect(within(dialog).getByText('Thành viên').nextSibling).toHaveTextContent('5');
    expect(within(dialog).getByText('Kênh kết nối').nextSibling).toHaveTextContent(
      'Không giới hạn',
    );
    // Internal limits are not listed, and limits the plan does not define are not invented.
    expect(within(dialog).queryByText(/storage/)).toBeNull();
    expect(within(dialog).queryByText('Khách hàng')).toBeNull();
  });

  it('offers a retry when the plan cannot be loaded', async () => {
    state = { isError: true };
    renderWithProviders(<PlanDialog open onOpenChange={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('closes from the footer button', async () => {
    state = { data: PRO };
    const onOpenChange = vi.fn();
    renderWithProviders(<PlanDialog open onOpenChange={onOpenChange} />);
    const dialog = screen.getByRole('dialog');
    const close = within(dialog)
      .getAllByRole('button', { name: 'Đóng' })
      .find((b) => b.textContent === 'Đóng');
    await userEvent.setup().click(close!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
