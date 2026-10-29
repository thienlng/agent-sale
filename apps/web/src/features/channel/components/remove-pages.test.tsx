import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { IntegrationsView } from './integrations-view';

const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  can.value = true;
});

const BOT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const page = (id: string, name: string, over: Partial<ChannelConnectionDto> = {}) =>
  ({
    id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e${id}`,
    provider: 'facebook',
    externalId: `100${id}`,
    name,
    status: 'connected',
    botId: null,
    expiresAt: null,
    createdAt: '2026-10-23T03:00:00.000Z',
    ...over,
  }) satisfies ChannelConnectionDto;

const providers = [
  { provider: 'facebook', configured: true },
  { provider: 'instagram', configured: true },
];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A tiny backend: GET /channels, DELETE /channels/:id (optionally failing once for some ids). */
function backend(initial: ChannelConnectionDto[], failOnce: string[] = []) {
  let data = [...initial];
  const deleted: string[] = [];
  const failing = new Set(failOnce);
  const stub = async (input: string, init: RequestInit = {}) => {
    const path = input.replace('/api/v1', '');
    const method = init.method ?? 'GET';
    if (method === 'GET' && path === '/channels') return json({ data, providers });
    if (method === 'GET' && path === '/bots') return json({ data: [] });
    if (method === 'DELETE' && path.startsWith('/channels/')) {
      const id = path.split('/').at(-1) ?? '';
      deleted.push(id);
      if (failing.delete(id)) return json({ error: { code: 'INTERNAL', message: 'Down' } }, 503);
      data = data.filter((c) => c.id !== id);
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  return { stub, deleted };
}

const qa = page('01', 'QA Actions', { status: 'disconnected' });
const shop = page('02', 'Shop Hoa', { botId: BOT });
const spa = page('03', 'Spa Lan', { provider: 'instagram' });
const site = page('04', 'Website Shop', {
  provider: 'website',
  externalId: 'wk_abcdefghijklmnopqrstuv',
});

describe('removing pages from platform integrations (T-133)', () => {
  it('removes a dead page from its row menu after confirmation', async () => {
    const api = backend([qa, shop]);
    vi.stubGlobal('fetch', api.stub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    const user = userEvent.setup();
    await screen.findByText('QA Actions');
    expect(screen.getByText('Mất kết nối')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tùy chọn cho QA Actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Gỡ trang' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Gỡ QA Actions khỏi Rapiz?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Bot sẽ ngừng trả lời và Rapiz không nhận tin nhắn mới từ trang này. Lịch sử hội thoại vẫn được giữ. Bạn có thể kết nối lại bất cứ lúc nào.',
      ),
    ).toBeInTheDocument();
    expect(api.deleted).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Gỡ trang' }));
    await waitFor(() => expect(api.deleted).toEqual([qa.id]));
    await waitFor(() => expect(screen.queryByText('QA Actions')).not.toBeInTheDocument());
    expect(screen.getByText('Shop Hoa')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const api = backend([qa]);
    vi.stubGlobal('fetch', api.stub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    const user = userEvent.setup();
    await screen.findByText('QA Actions');
    await user.click(screen.getByRole('button', { name: 'Tùy chọn cho QA Actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Gỡ trang' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hủy' }),
    );
    expect(api.deleted).toEqual([]);
    expect(screen.getByText('QA Actions')).toBeInTheDocument();
  });

  it('hides the row menu and the bulk action from users who cannot manage channels', async () => {
    can.value = false;
    vi.stubGlobal('fetch', backend([qa, shop]).stub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    await screen.findByText('QA Actions');
    expect(screen.queryByRole('button', { name: /Tùy chọn cho/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gỡ trang' })).not.toBeInTheDocument();
  });

  it('does not offer removal for website chat', async () => {
    vi.stubGlobal('fetch', backend([site, qa]).stub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    const user = userEvent.setup();
    await screen.findByText('Website Shop');
    expect(
      screen.queryByRole('button', { name: 'Tùy chọn cho Website Shop' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Website Shop' }));
    expect(screen.getByRole('button', { name: 'Gỡ trang' })).toBeDisabled();
  });

  it('removes several selected pages, keeps failures selected and retries only them', async () => {
    const api = backend([qa, shop, spa], [spa.id]);
    vi.stubGlobal('fetch', api.stub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    const user = userEvent.setup();
    await screen.findByText('QA Actions');
    expect(screen.getByRole('button', { name: 'Gỡ trang' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Chọn QA Actions' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Spa Lan' }));
    await user.click(screen.getByRole('button', { name: 'Gỡ trang' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Gỡ 2 trang khỏi Rapiz?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Gỡ trang' }));
    await waitFor(() => expect(api.deleted).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText('QA Actions')).not.toBeInTheDocument());
    // The dialog stays open for the page that failed, which keeps the list behind it inert.
    expect(screen.getByRole('checkbox', { name: 'Chọn Spa Lan', hidden: true })).toBeChecked();
    dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Gỡ Spa Lan khỏi Rapiz?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Gỡ trang' }));
    await waitFor(() => expect(api.deleted).toHaveLength(3));
    expect(api.deleted.filter((id) => id === qa.id)).toHaveLength(1);
    expect(api.deleted.filter((id) => id === spa.id)).toHaveLength(2);
    await waitFor(() => expect(screen.queryByText('Spa Lan')).not.toBeInTheDocument());
  });
});
