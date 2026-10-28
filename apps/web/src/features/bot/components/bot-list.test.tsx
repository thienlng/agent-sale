import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { BotList } from './bot-list';

const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  // Radix tooltips observe their trigger on hover.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  can.value = true;
});

const ID_ON = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const ID_IDLE = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d02';
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
const bot = (id: string, name: string, isActive: boolean) => ({
  id,
  name,
  industry: 'retail',
  isActive,
  settings,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const page = (botId: string | null) => ({
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e01',
  provider: 'facebook',
  externalId: '1001',
  name: 'Trang Lan',
  status: 'connected',
  botId,
  expiresAt: null,
  createdAt: '2026-10-23T03:00:00.000Z',
});

function routes(over: Record<string, { status: number; body?: unknown }> = {}) {
  return {
    'GET /bots': {
      status: 200,
      body: { data: [bot(ID_ON, 'Bot Lan', true), bot(ID_IDLE, 'Bot rảnh', false)] },
    },
    'GET /channels': {
      status: 200,
      body: { data: [page(ID_ON)], providers: [{ provider: 'facebook', configured: true }] },
    },
    [`DELETE /bots/${ID_ON}`]: { status: 204 },
    [`DELETE /bots/${ID_IDLE}`]: { status: 204 },
    ...over,
  };
}

describe('BotList actions', () => {
  it('links the gear button straight to the bot settings', async () => {
    vi.stubGlobal('fetch', stubFetch(routes()).fetchStub);
    renderWithRouter(() => <BotList />);
    const links = await screen.findAllByRole('link', { name: 'Cài đặt' });
    expect(links[0]?.getAttribute('href')).toBe(`/app/bots/${ID_ON}/settings`);
    expect(links[1]?.getAttribute('href')).toBe(`/app/bots/${ID_IDLE}/settings`);
  });

  it('requires the bot name for an active bot, then deletes it and refreshes the list', async () => {
    const stub = stubFetch(routes());
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => <BotList />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Xóa bot' }))[0]!);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Bot ngừng trả lời khách');
    const confirm = screen.getAllByRole('button', { name: 'Xóa bot' }).at(-1)!;
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(/Gõ tên bot/), 'Bot Lan');
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() =>
      expect(stub.calls.some((c) => c.key === `DELETE /bots/${ID_ON}`)).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // The list is refetched after the delete.
    await waitFor(() => expect(stub.calls.filter((c) => c.key === 'GET /bots').length).toBe(2));
  });

  it('only asks for a simple confirm for an idle bot nothing uses', async () => {
    const stub = stubFetch(routes());
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => <BotList />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Xóa bot' }))[1]!);
    await screen.findByRole('alertdialog');
    await waitFor(() => expect(stub.calls.some((c) => c.key === 'GET /channels')).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText(/Gõ tên bot/)).toBeNull());
    await user.click(screen.getAllByRole('button', { name: 'Xóa bot' }).at(-1)!);
    await waitFor(() =>
      expect(stub.calls.some((c) => c.key === `DELETE /bots/${ID_IDLE}`)).toBe(true),
    );
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const stub = stubFetch(routes());
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => <BotList />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Xóa bot' }))[1]!);
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(stub.calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
  });

  it('hides settings and delete without the bots.manage capability', async () => {
    can.value = false;
    vi.stubGlobal('fetch', stubFetch(routes()).fetchStub);
    renderWithRouter(() => <BotList />);
    await screen.findByText('Bot Lan');
    expect(screen.queryByRole('link', { name: 'Cài đặt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa bot' })).toBeNull();
  });
});

describe('direct bot activation', () => {
  it('toggles a bot from the list without navigating', async () => {
    const stub = stubFetch(
      routes({ [`PATCH /bots/${ID_IDLE}`]: { status: 200, body: bot(ID_IDLE, 'Bot rảnh', true) } }),
    );
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => <BotList />);
    const control = await screen.findByRole('switch', { name: 'Bật hoặc tắt bot Bot rảnh' });
    expect(control).not.toBeChecked();
    await userEvent.setup().click(control);
    await waitFor(() => expect(control).toBeChecked());
    expect(stub.calls.find((call) => call.key === `PATCH /bots/${ID_IDLE}`)?.body).toEqual({
      isActive: true,
    });
  });
  it('restores the saved state when the update fails', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        routes({
          [`PATCH /bots/${ID_IDLE}`]: {
            status: 500,
            body: { code: 'INTERNAL', message: 'Unavailable' },
          },
        }),
      ).fetchStub,
    );
    renderWithRouter(() => <BotList />);
    const control = await screen.findByRole('switch', { name: 'Bật hoặc tắt bot Bot rảnh' });
    await userEvent.setup().click(control);
    await waitFor(() => expect(control).not.toBeDisabled());
    expect(control).not.toBeChecked();
  });
  it('does not expose a list switch to users without bot management permission', async () => {
    can.value = false;
    vi.stubGlobal('fetch', stubFetch(routes()).fetchStub);
    renderWithRouter(() => <BotList />);
    await screen.findByText('Bot Lan');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

it('keeps the direct switch pending and prevents duplicate requests', async () => {
  const stub = stubFetch(routes());
  let finish: (value: Response) => void = () => {};
  let calls = 0;
  vi.stubGlobal('fetch', (input: string, init: RequestInit = {}) => {
    if (init.method === 'PATCH') {
      calls++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return stub.fetchStub(input, init);
  });
  renderWithRouter(() => <BotList />);
  const user = userEvent.setup();
  const control = await screen.findByRole('switch', { name: 'Bật hoặc tắt bot Bot rảnh' });
  await user.click(control);
  await waitFor(() => expect(control).toBeDisabled());
  expect(control).toBeChecked();
  await user.click(control);
  expect(calls).toBe(1);
  finish(new Response(JSON.stringify(bot(ID_IDLE, 'Bot rảnh', true)), { status: 200 }));
  await waitFor(() => expect(control).not.toBeDisabled());
  expect(control).toBeChecked();
});

it('labels legacy bot industries without removing their existing controls', async () => {
  vi.stubGlobal('fetch', stubFetch(routes()).fetchStub);
  renderWithRouter(() => (
    <BotList
      business={{
        status: 'success',
        workspace: { name: 'Hotel business', industry: 'hotel' },
        onRetry: vi.fn(),
      }}
    />
  ));
  await screen.findByText('Bot Lan');
  expect(screen.getAllByText(/Bot đang dùng lĩnh vực cũ/)).toHaveLength(2);
  expect(screen.getAllByText(/Lĩnh vực doanh nghiệp là Khách sạn/)).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: 'Xóa bot' })).toHaveLength(2);
});
