import type * as Router from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/testing/render';
import { CreateBotDialog } from './create-bot-dialog';

const mutation = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../api/bots', () => ({ useCreateBot: () => ({ ...mutation, isPending: false }) }));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  useNavigate: () => vi.fn(),
}));
beforeEach(() => {
  mutation.mutate.mockReset();
});
const business = (industry: string, name = 'Hotel business') => ({
  status: 'success' as const,
  workspace: { name, industry },
  onRetry: vi.fn(),
});

describe('business-scoped bot creation', () => {
  it('uses the selected business industry without another choice and follows a business change', async () => {
    const props = { open: true, onOpenChange: vi.fn() };
    const view = renderWithProviders(<CreateBotDialog {...props} business={business('hotel')} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Lĩnh vực kinh doanh')).toHaveValue('Khách sạn / homestay');
    await userEvent.type(screen.getByLabelText('Tên bot'), 'Assistant');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo bot' }));
    expect(mutation.mutate).toHaveBeenLastCalledWith(
      { name: 'Assistant', industry: 'hotel' },
      expect.anything(),
    );
    view.rerender(
      <CreateBotDialog {...props} business={business('fashion', 'Fashion business')} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tạo bot' }));
    expect(mutation.mutate).toHaveBeenLastCalledWith(
      { name: 'Assistant', industry: 'fashion' },
      expect.anything(),
    );
  });

  it('blocks creation for an unsupported stored industry instead of falling back to retail', async () => {
    renderWithProviders(
      <CreateBotDialog open onOpenChange={vi.fn()} business={business('legacy-rooms')} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('legacy-rooms');
    expect(screen.getByRole('button', { name: 'Tạo bot' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Tên bot'), 'Do not create');
    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it('keeps creation blocked while business context loads or fails and offers retry', async () => {
    const props = { open: true, onOpenChange: vi.fn() };
    const onRetry = vi.fn();
    const view = renderWithProviders(
      <CreateBotDialog
        {...props}
        business={{ status: 'pending', workspace: undefined, onRetry }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Tạo bot' })).toBeDisabled();
    view.rerender(
      <CreateBotDialog {...props} business={{ status: 'error', workspace: undefined, onRetry }} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Tạo bot' })).toBeDisabled();
  });
});
