import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Providers } from '@/app/providers';
import { renderWithProviders, renderWithRouter, stubFetch } from '@/testing/render';

import { useSelectAccounts } from '../api/channels';
import { IntegrationsView } from './integrations-view';

const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  can.value = true;
});

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
  it('workspace mode: "Chưa gán bot" lists connected pages without a bot', async () => {
    const { fetchStub } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    expect(await screen.findByText('Kèn Cờ Nải')).toBeInTheDocument();
    expect(await screen.findByText('Bot: Trợ lý A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Chưa gán bot' }));
    expect(screen.getByText('Shop Hoa')).toBeInTheDocument();
    expect(screen.queryByText('Kèn Cờ Nải')).not.toBeInTheDocument();
    expect(
      within(screen.getByText('Shop Hoa').closest('li')!).getByText('Chưa gán bot'),
    ).toBeInTheDocument();
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

  it('bot mode: shows only the bot pages and "Hủy gán bot" unbinds them', async () => {
    const { fetchStub, calls } = stubFetch({
      ...routes,
      [`PATCH /channels/${mine.id}`]: { status: 200, body: { ...mine, botId: null } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <IntegrationsView mode={{ kind: 'bot', botId: BOT_A }} />);
    expect(await screen.findByText('Kèn Cờ Nải')).toBeInTheDocument();
    expect(screen.queryByText('Shop Hoa')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chưa gán bot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đồng bộ tin nhắn' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Chọn Kèn Cờ Nải' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hủy gán bot' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hủy gán bot' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH /channels/${mine.id}`)?.body).toEqual({
        botId: null,
      }),
    );
  });

  it('bot mode: "Chọn trang" asks before taking a page from another bot', async () => {
    const { fetchStub, calls } = stubFetch({
      ...routes,
      [`PATCH /channels/${other.id}`]: { status: 200, body: { ...other, botId: BOT_A } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <IntegrationsView mode={{ kind: 'bot', botId: BOT_A }} />);
    await screen.findByText('Kèn Cờ Nải');
    await userEvent.click(screen.getByRole('button', { name: /Chọn trang/ }));
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

it('unassigns a page from the outer inventory without disconnecting it', async () => {
  const { fetchStub, calls } = stubFetch({
    ...routes,
    [`PATCH /channels/${mine.id}`]: { status: 200, body: { ...mine, botId: null } },
  });
  vi.stubGlobal('fetch', fetchStub);
  renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
  await screen.findByText('Kèn Cờ Nải');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Chọn Kèn Cờ Nải' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hủy gán bot' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hủy gán bot' }));
  await waitFor(() =>
    expect(calls.find((call) => call.key === `PATCH /channels/${mine.id}`)?.body).toEqual({
      botId: null,
    }),
  );
});

it('combines the bot assignment filter with page search', async () => {
  vi.stubGlobal('fetch', stubFetch(routes).fetchStub);
  renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
  await screen.findByText('Kèn Cờ Nải');
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Lọc theo bot'), BOT_B);
  expect(screen.getByText('Spa Lan')).toBeInTheDocument();
  expect(screen.queryByText('Shop Hoa')).not.toBeInTheDocument();
  await user.type(screen.getByRole('searchbox'), 'not a page');
  expect(screen.queryByText('Spa Lan')).not.toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox'));
  await user.selectOptions(screen.getByLabelText('Lọc theo bot'), 'unassigned');
  expect(screen.getByText('Shop Hoa')).toBeInTheDocument();
  expect(screen.queryByText('Spa Lan')).not.toBeInTheDocument();
});

it('assigns multiple pages, confirms reassignment and refreshes the bot view', async () => {
  const data = [{ ...free }, { ...mine }, { ...other }];
  const stub = stubFetch({
    ...routes,
    'GET /channels': { status: 200, body: { ...routes['GET /channels'].body, data } },
  });
  const updates: Array<{ id: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    if (init.method === 'PATCH') {
      const id = input.split('/').at(-1)!;
      const body = JSON.parse(String(init.body));
      updates.push({ id, body });
      const entry = data.find((c) => c.id === id)!;
      entry.botId = body.botId;
      return new Response(JSON.stringify(entry), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return stub.fetchStub(input, init);
  });
  renderWithRouter(function Views() {
    const [mode, setMode] = useState<{ kind: 'workspace' } | { kind: 'bot'; botId: string }>({
      kind: 'workspace',
    });
    return (
      <>
        <button onClick={() => setMode({ kind: 'bot', botId: BOT_B })}>Open bot inventory</button>
        <IntegrationsView mode={mode} />
      </>
    );
  });
  const user = userEvent.setup();
  await screen.findByText('Kèn Cờ Nải');
  await user.click(screen.getByRole('checkbox', { name: 'Chọn Shop Hoa' }));
  await user.click(screen.getByRole('checkbox', { name: 'Chọn Kèn Cờ Nải' }));
  await user.click(screen.getByRole('button', { name: 'Gán bot' }));
  screen.getByRole('combobox', { name: 'Bot trả lời' }).focus();
  await user.keyboard('{ArrowDown}');
  (await screen.findByRole('option', { name: 'Trợ lý B' })).focus();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: 'Lưu' }));
  const confirmation = await screen.findByRole('alertdialog');
  expect(updates).toEqual([]);
  await user.click(within(confirmation).getByRole('button', { name: 'Chuyển trang' }));
  await waitFor(() => expect(updates).toHaveLength(2));
  expect(updates).toEqual(
    expect.arrayContaining([
      { id: free.id, body: { botId: BOT_B } },
      { id: mine.id, body: { botId: BOT_B } },
    ]),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Open bot inventory' }));
  expect(await screen.findByText('Shop Hoa')).toBeInTheDocument();
  expect(screen.getByText('Kèn Cờ Nải')).toBeInTheDocument();
});

it('requires an actual bot choice before saving a bulk assignment', async () => {
  vi.stubGlobal('fetch', stubFetch(routes).fetchStub);
  renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
  const user = userEvent.setup();
  await screen.findByText('Kèn Cờ Nải');
  await user.click(screen.getByRole('checkbox', { name: 'Chọn Kèn Cờ Nải' }));
  await user.click(screen.getByRole('checkbox', { name: 'Chọn Spa Lan' }));
  await user.click(screen.getByRole('button', { name: 'Gán bot' }));
  expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Bot trả lời' })).toHaveTextContent(
    'Chọn bot trả lời',
  );
});

it('disables management controls without settings permission', async () => {
  can.value = false;
  vi.stubGlobal('fetch', stubFetch(routes).fetchStub);
  renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
  await screen.findByText('Kèn Cờ Nải');
  for (const control of screen.getAllByRole('checkbox')) expect(control).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Gán bot' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Hủy gán bot' })).toBeDisabled();
});

it('keeps only failed pages selected and retries them without repeating successes', async () => {
  const data = [{ ...mine }, { ...other }];
  const stub = stubFetch({
    ...routes,
    'GET /channels': { status: 200, body: { ...routes['GET /channels'].body, data } },
  });
  const updated: string[] = [];
  let fail = true;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    if (init.method === 'PATCH') {
      const id = input.split('/').at(-1)!;
      updated.push(id);
      if (id === other.id && fail) {
        fail = false;
        return new Response(
          JSON.stringify({ error: { code: 'INTERNAL', message: 'Unavailable' } }),
          { status: 503 },
        );
      }
      const entry = data.find((c) => c.id === id)!;
      entry.botId = null;
      return new Response(JSON.stringify(entry), { status: 200 });
    }
    return stub.fetchStub(input, init);
  });
  renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
  const user = userEvent.setup();
  await screen.findByText('Kèn Cờ Nải');
  await user.click(screen.getByRole('checkbox', { name: 'Chọn Kèn Cờ Nải' }));
  await user.click(screen.getByRole('checkbox', { name: 'Chọn Spa Lan' }));
  async function confirmUnassign() {
    await user.click(screen.getByRole('button', { name: 'Hủy gán bot' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Hủy gán bot' }));
  }
  await confirmUnassign();
  await waitFor(() => expect(updated).toHaveLength(2));
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Chọn Kèn Cờ Nải' })).not.toBeChecked(),
  );
  expect(screen.getByRole('checkbox', { name: 'Chọn Spa Lan' })).toBeChecked();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Hủy gán bot' })).not.toBeDisabled(),
  );
  await confirmUnassign();
  await waitFor(() => expect(updated).toHaveLength(3));
  expect(updated.filter((id) => id === mine.id)).toHaveLength(1);
  expect(updated.filter((id) => id === other.id)).toHaveLength(2);
});

it('refreshes setup readiness and inbox after discovery connects and binds a page', async () => {
  const discovery = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f00';
  vi.stubGlobal(
    'fetch',
    stubFetch({
      [`POST /channels/discoveries/${discovery}/select`]: { status: 200, body: { data: [free] } },
      [`PATCH /channels/${free.id}`]: { status: 200, body: { ...free, botId: BOT_A } },
    }).fetchStub,
  );
  const { result } = renderHook(
    () => ({ select: useSelectAccounts(BOT_A), client: useQueryClient() }),
    { wrapper: Providers },
  );
  const invalidated = vi.spyOn(result.current.client, 'invalidateQueries');
  await act(async () => {
    await result.current.select.mutateAsync({ id: discovery, externalIds: [free.externalId] });
  });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['channels', 'ws-1'] });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['inbox', 'ws-1'] });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['ws', 'ws-1', 'bots'] });
});
