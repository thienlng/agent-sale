import type * as Router from '@tanstack/react-router';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPageContext, fillAssistantForm } from '@/lib/assistant-context';
import { renderWithProviders } from '@/testing/render';
import type * as BotsApi from '../api/bots';
import { BotList } from './bot-list';
import { CreateBotDialog } from './create-bot-dialog';

const mutation = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../api/bots', async (original) => ({
  ...(await original<typeof BotsApi>()),
  useCreateBot: () => ({ ...mutation, isPending: false }),
  useBots: () => ({ data: [], isPending: false, isError: false }),
}));
const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  useNavigate: () => vi.fn(),
}));
beforeEach(() => {
  can.value = true;
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

describe('owner assistant', () => {
  const botForm = () => collectPageContext('/app/bots').forms?.find((f) => f.id === 'bot');

  it('registers the closed dialog and opens it with the drafted name, without creating', async () => {
    renderWithProviders(<BotList business={business('hotel')} />);
    expect(botForm()?.fields).toEqual([
      { name: 'name', label: 'Tên bot', type: 'text', empty: true },
    ]);
    let result: ReturnType<typeof fillAssistantForm> | undefined;
    act(() => {
      result = fillAssistantForm('bot', { name: 'Lễ tân Đà Lạt' });
    });
    expect(result).toMatchObject({ ok: true, opensDialog: true });
    expect(await screen.findByLabelText('Tên bot')).toHaveValue('Lễ tân Đà Lạt');
    // The open dialog now holds the form and fills its own name.
    act(() => {
      result = fillAssistantForm('bot', { name: 'x'.repeat(100) });
    });
    expect(result).toMatchObject({ ok: true, opensDialog: false });
    expect(screen.getByLabelText('Tên bot')).toHaveValue('x'.repeat(80));
    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it('starts empty again when reopened without a draft', async () => {
    const props = { onOpenChange: vi.fn(), business: business('hotel') };
    const view = renderWithProviders(<CreateBotDialog {...props} open prefill={{ name: 'A' }} />);
    expect(screen.getByLabelText('Tên bot')).toHaveValue('A');
    view.rerender(<CreateBotDialog {...props} open={false} />);
    view.rerender(<CreateBotDialog {...props} open />);
    expect(await screen.findByLabelText('Tên bot')).toHaveValue('');
  });

  it('registers no bot form for a business whose industry is unsupported', () => {
    renderWithProviders(<BotList business={business('legacy-rooms')} />);
    expect(botForm()).toBeUndefined();
  });

  it('registers no bot form for a member who cannot manage bots', () => {
    can.value = false;
    renderWithProviders(<BotList business={business('hotel')} />);
    expect(botForm()).toBeUndefined();
  });
});
