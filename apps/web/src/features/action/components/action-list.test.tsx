import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { ActionList } from './action-list';
import { actionDto, BOT_ID } from './fixtures';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  // jsdom lacks these; Radix Select needs them to open.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

const orders = actionDto();
const booking = actionDto({
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a02',
  name: 'Đặt lịch hẹn',
  method: 'POST',
  url: 'https://shop.vn/bookings',
  enabled: false,
});
const list = `GET /bots/${BOT_ID}/actions`;

async function setup(
  data = [orders, booking],
  extra: Record<string, { status: number; body?: unknown }> = {},
) {
  const stub = stubFetch({ [list]: { status: 200, body: { data } }, ...extra });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => <ActionList botId={BOT_ID} />);
  // The first render pays for module loading, so the default 1s wait is too tight.
  await screen.findByRole('heading', { name: 'Hành động API' }, { timeout: 10_000 });
  return stub;
}

describe('ActionList', () => {
  it('lists name, method and url for every action', async () => {
    await setup();
    expect(await screen.findByText('Tra cứu đơn hàng')).toBeInTheDocument();
    expect(screen.getByText('Đặt lịch hẹn')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('https://shop.vn/bookings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Thêm hành động/ })).toBeInTheDocument();
  });

  it('searches by name', async () => {
    await setup();
    await screen.findByText('Tra cứu đơn hàng');
    await userEvent.type(screen.getByLabelText('Tìm kiếm'), 'lịch');
    expect(screen.queryByText('Tra cứu đơn hàng')).not.toBeInTheDocument();
    expect(screen.getByText('Đặt lịch hẹn')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Tìm kiếm'));
    await userEvent.type(screen.getByLabelText('Tìm kiếm'), 'zzz');
    expect(screen.getByText('Không có hành động phù hợp')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    await setup();
    await screen.findByText('Tra cứu đơn hàng');
    await userEvent.click(screen.getByRole('combobox', { name: 'Trạng thái' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Đã tắt' }));
    expect(screen.queryByText('Tra cứu đơn hàng')).not.toBeInTheDocument();
    expect(screen.getByText('Đặt lịch hẹn')).toBeInTheDocument();
  });

  it('toggles an action with a PATCH of { enabled }', async () => {
    const { calls } = await setup([orders, booking], {
      [`PATCH /bots/${BOT_ID}/actions/${booking.id}`]: {
        status: 200,
        body: { ...booking, enabled: true },
      },
    });
    await screen.findByText('Đặt lịch hẹn');
    await userEvent.click(screen.getByRole('switch', { name: 'Bật/tắt Đặt lịch hẹn' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({ enabled: true }),
    );
  });

  it('deletes only after the confirmation', async () => {
    const { calls } = await setup([orders], {
      [`DELETE /bots/${BOT_ID}/actions/${orders.id}`]: { status: 204 },
    });
    await screen.findByText('Tra cứu đơn hàng');
    await userEvent.click(screen.getByRole('button', { name: 'Xóa Tra cứu đơn hàng' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(true));
  });

  it('shows the empty state with a way to add the first action', async () => {
    await setup([]);
    expect(await screen.findByText('Chưa có hành động nào')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Thêm hành động/ })).toBeInTheDocument();
  });
});
