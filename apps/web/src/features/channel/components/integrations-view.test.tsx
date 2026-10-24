import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Providers } from '@/app/providers';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { useSelectAccounts } from '../api/channels';
import { IntegrationsView } from './integrations-view';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());

const BOT_A = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const BOT_B = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d02';
const settings = {
  mission: '',
  greeting: '',
  selfPronoun: 'em',
  customerPronoun: 'anh/chị',
  useCustomerName: true,
  fallbackMessage: '',
  handoffMessage: '',
  creativity: 'balanced',
  modelTier: 'basic',
  language: 'vi',
  placeholders: {},
};
const bot = (id: string, name: string) => ({
  id,
  name,
  industry: 'retail',
  isActive: true,
  settings,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
function page(id: string, name: string, over: Partial<ChannelConnectionDto> = {}) {
  return {
    id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e${id}`,
    provider: 'facebook',
    externalId: `100${id}`,
    name,
    status: 'connected',
    botId: null,
    expiresAt: null,
    createdAt: '2026-10-23T03:00:00.000Z',
    ...over,
  } satisfies ChannelConnectionDto;
}
const free = page('01', 'Shop Hoa');
const mine = page('02', 'Kèn Cờ Nải', { botId: BOT_A });
const other = page('03', 'Spa Lan', { botId: BOT_B, provider: 'instagram' });
const routes = {
  'GET /channels': {
    status: 200,
    body: {
      data: [free, mine, other],
      providers: [
        { provider: 'facebook', configured: true },
        { provider: 'instagram', configured: false },
      ],
    },
  },
  'GET /bots': { status: 200, body: { data: [bot(BOT_A, 'Trợ lý A'), bot(BOT_B, 'Trợ lý B')] } },
};

describe('IntegrationsView', () => {
  it('workspace mode: "Chờ kích hoạt" lists connected pages without a bot', async () => {
    const { fetchStub } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    expect(await screen.findByText('Kèn Cờ Nải')).toBeInTheDocument();
    expect(await screen.findByText('Bot: Trợ lý A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Chờ kích hoạt' }));
    expect(screen.getByText('Shop Hoa')).toBeInTheDocument();
    expect(screen.queryByText('Kèn Cờ Nải')).not.toBeInTheDocument();
    expect(screen.getByText('Chưa gán bot')).toBeInTheDocument();
  });

  it('workspace mode: Instagram unconfigured disables its connect button', async () => {
    const { fetchStub } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    await screen.findByText('Kèn Cờ Nải');
    await userEvent.click(screen.getByRole('button', { name: 'Instagram' }));
    expect(screen.getByRole('button', { name: 'Kết nối Instagram' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Zalo' }));
    expect(screen.getByText('Zalo sắp có')).toBeInTheDocument();
  });

  it('bot mode: shows only the bot pages and "Hủy kích hoạt" unbinds them', async () => {
    const { fetchStub, calls } = stubFetch({
      ...routes,
      [`PATCH /channels/${mine.id}`]: { status: 200, body: { ...mine, botId: null } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'bot', botId: BOT_A }} />);
    expect(await screen.findByText('Kèn Cờ Nải')).toBeInTheDocument();
    expect(screen.queryByText('Shop Hoa')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chờ kích hoạt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đồng bộ tin nhắn' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Chọn Kèn Cờ Nải' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hủy kích hoạt' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hủy kích hoạt' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH /channels/${mine.id}`)?.body).toEqual({
        botId: null,
      }),
    );
  });

  it('bot mode: "Chỉnh sửa" asks before taking a page from another bot', async () => {
    const { fetchStub, calls } = stubFetch({
      ...routes,
      [`PATCH /channels/${other.id}`]: { status: 200, body: { ...other, botId: BOT_A } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'bot', botId: BOT_A }} />);
    await screen.findByText('Kèn Cờ Nải');
    await userEvent.click(screen.getByRole('button', { name: /Chỉnh sửa/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Đang gán: Trợ lý B')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Spa Lan/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Chuyển trang' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH /channels/${other.id}`)?.body).toEqual({
        botId: BOT_A,
      }),
    );
  });
});

describe('useSelectAccounts', () => {
  const discovery = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f00';
  const created = page('09', 'Trang mới');
  it('binds the newly connected pages to the bot after the selection', async () => {
    const { fetchStub, calls } = stubFetch({
      [`POST /channels/discoveries/${discovery}/select`]: {
        status: 200,
        body: { data: [created] },
      },
      [`PATCH /channels/${created.id}`]: { status: 200, body: { ...created, botId: BOT_A } },
      ...routes,
    });
    vi.stubGlobal('fetch', fetchStub);
    const { result } = renderHook(() => useSelectAccounts(BOT_A), { wrapper: Providers });
    let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ id: discovery, externalIds: ['10009'] });
    });
    expect(out?.bindFailed).toBe(0);
    expect(calls.find((c) => c.key === `PATCH /channels/${created.id}`)?.body).toEqual({
      botId: BOT_A,
    });
  });
  it('does not bind anything in workspace mode', async () => {
    const { fetchStub, calls } = stubFetch({
      [`POST /channels/discoveries/${discovery}/select`]: {
        status: 200,
        body: { data: [created] },
      },
      ...routes,
    });
    vi.stubGlobal('fetch', fetchStub);
    const { result } = renderHook(() => useSelectAccounts(), { wrapper: Providers });
    await act(async () => {
      await result.current.mutateAsync({ id: discovery, externalIds: ['10009'] });
    });
    expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
  });
});
