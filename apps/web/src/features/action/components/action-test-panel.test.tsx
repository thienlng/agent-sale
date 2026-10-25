import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { emptyParam, type ParamRow } from '../lib/action-form';
import { ActionTestPanel } from './action-test-panel';
import { BOT_ID } from './fixtures';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());
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

const ACTION_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';
const params: ParamRow[] = [
  { ...emptyParam(), name: 'orderId', location: 'path' },
  { ...emptyParam(), name: 'qty', type: 'number', required: false },
];
const route = `POST /bots/${BOT_ID}/actions/${ACTION_ID}/test`;

describe('ActionTestPanel', () => {
  it('asks to save first when the action does not exist yet', () => {
    renderWithProviders(<ActionTestPanel botId={BOT_ID} actionId={undefined} params={params} />);
    expect(screen.getByText('Lưu hành động trước khi thử gọi.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử gọi' })).not.toBeInTheDocument();
  });

  it('sends typed sample args and renders status, latency and data', async () => {
    const { fetchStub, calls } = stubFetch({
      [route]: {
        status: 200,
        body: {
          ok: true,
          statusCode: 200,
          data: { status: 'shipped' },
          errorCode: null,
          latencyMs: 120,
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<ActionTestPanel botId={BOT_ID} actionId={ACTION_ID} params={params} />);
    await userEvent.type(screen.getByLabelText('orderId'), 'A1');
    await userEvent.type(screen.getByLabelText('qty'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Thử gọi' }));
    expect(await screen.findByText('Thành công')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('120 ms')).toBeInTheDocument();
    expect(screen.getByText(/"status": "shipped"/)).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ args: { orderId: 'A1', qty: 2 } });
  });

  it('renders a failed call with a localized reason', async () => {
    const { fetchStub } = stubFetch({
      [route]: {
        status: 200,
        body: { ok: false, statusCode: null, data: null, errorCode: 'blocked_host', latencyMs: 3 },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<ActionTestPanel botId={BOT_ID} actionId={ACTION_ID} params={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thử gọi' }));
    expect(await screen.findByText('Thất bại')).toBeInTheDocument();
    expect(screen.getByText('Địa chỉ không được phép gọi')).toBeInTheDocument();
  });

  it('shows an error when the request itself fails', async () => {
    const { fetchStub } = stubFetch({
      [route]: { status: 500, body: { code: 'INTERNAL', message: 'boom' } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<ActionTestPanel botId={BOT_ID} actionId={ACTION_ID} params={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thử gọi' }));
    await waitFor(() =>
      expect(screen.getByText('Không gọi được. Thử lại sau.')).toBeInTheDocument(),
    );
  });
});
