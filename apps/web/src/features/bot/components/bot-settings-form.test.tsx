import type { BotDto } from '@agent-sales/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { BotSettingsForm } from './bot-settings-form';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
afterEach(() => vi.unstubAllGlobals());

const BOT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a00';
const bot = {
  id: BOT,
  name: 'Bot',
  industry: 'retail',
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  settings: {
    mission: 'Tư vấn',
    greeting: 'Xin chào',
    selfPronoun: 'em',
    customerPronoun: 'anh/chị',
    replyLength: 'short',
    tone: 'friendly',
    allowEmoji: false,
    useCustomerName: true,
    fallbackMessage: 'x',
    handoffMessage: 'y',
    creativity: 'balanced',
    modelTier: 'smart',
    language: 'vi',
    themeColor: '#f97316',
    replySchedule: { mode: 'always', start: '08:00', end: '22:00' },
    autoResumeAfterManual: true,
    humanTakeoverMinutes: 5,
    silenceOnExternalReply: true,
    placeholders: { 'store.name': 'Shop' },
    profile: { fields: {}, notes: '' },
    orderTaking: false,
    orderShippingFeeVnd: null,
  },
} as unknown as BotDto;

describe('BotSettingsForm advanced tab', () => {
  it('keeps technical items only and points to the screens that own the rest', async () => {
    const stub = stubFetch({});
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => <BotSettingsForm bot={bot} />);
    await userEvent.click(
      await screen.findByRole('tab', { name: /nâng cao/i }, { timeout: 10_000 }),
    );
    expect(await screen.findByLabelText('Khi bot chưa có thông tin')).toBeInTheDocument();
    expect(screen.getByLabelText('Khi chuyển cho nhân viên')).toBeInTheDocument();
    for (const label of ['Nhiệm vụ của bot', 'Lời chào', 'Bot xưng là', 'Gọi khách là'])
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    expect(screen.queryByText('Thông tin cửa hàng')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hướng dẫn trả lời' })).toHaveAttribute(
      'href',
      `/app/bots/${BOT}/instructions`,
    );
    expect(screen.getByRole('link', { name: 'Thông tin doanh nghiệp' })).toHaveAttribute(
      'href',
      `/app/bots/${BOT}/knowledge`,
    );
  });
});

describe('BotSettingsForm order taking', () => {
  const withSettings = (settings: Partial<BotDto['settings']>) =>
    ({ ...bot, settings: { ...bot.settings, ...settings } }) as BotDto;

  async function open(target: BotDto) {
    const stub = stubFetch({ [`PATCH /bots/${BOT}`]: { status: 200, body: target } });
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => <BotSettingsForm bot={target} />);
    await userEvent.click(
      await screen.findByRole('tab', { name: /nâng cao/i }, { timeout: 10_000 }),
    );
    return stub.calls;
  }

  it('turns order taking on with a default shipping fee', async () => {
    const calls = await open(bot);
    expect(await screen.findByRole('heading', { name: 'Chốt đơn' })).toBeInTheDocument();
    expect(
      screen.getByText(/Để trống: tóm tắt đơn ghi “Phí ship: shop báo sau”/),
    ).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Bot chốt đơn' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    const fee = screen.getByLabelText('Phí ship mặc định');
    await userEvent.type(fee, '30000');
    expect(fee).toHaveValue('30.000');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({
      settings: { orderTaking: true, orderShippingFeeVnd: 30000 },
    });
  });

  it('sends null when the fee is cleared and keeps zero as free shipping', async () => {
    const calls = await open(withSettings({ orderTaking: true, orderShippingFeeVnd: 25000 }));
    const fee = await screen.findByLabelText('Phí ship mặc định');
    expect(fee).toHaveValue('25.000');
    expect(screen.getByRole('switch', { name: 'Bot chốt đơn' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.clear(fee);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ settings: { orderShippingFeeVnd: null } });
  });

  it('keeps an explicit zero fee', async () => {
    const calls = await open(bot);
    await userEvent.type(await screen.findByLabelText('Phí ship mặc định'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ settings: { orderShippingFeeVnd: 0 } });
  });

  it('keeps digits only, groups them and saves the number', async () => {
    const calls = await open(bot);
    const fee = await screen.findByLabelText('Phí ship mặc định');
    await userEvent.type(fee, '3a0.0x00');
    expect(fee).toHaveValue('30.000');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ settings: { orderShippingFeeVnd: 30000 } });
  });
});
