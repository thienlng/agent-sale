import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import type { ActionInput } from '@agent-sales/contracts';

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
const route = `POST /bots/${BOT_ID}/actions/test`;
const draft = { name: 'draft' } as ActionInput;
const panel = (over: {
  actionId?: string;
  params?: ParamRow[];
  build?: () => ActionInput | null;
  key?: string;
}) => (
  <ActionTestPanel
    botId={BOT_ID}
    actionId={over.actionId}
    params={over.params ?? []}
    buildDraft={over.build ?? (() => draft)}
    draftKey={over.key ?? 'k'}
  />
);

describe('ActionTestPanel', () => {
  it('is usable before the action is saved', () => {
    renderWithProviders(panel({ params }));
    expect(screen.getByRole('button', { name: 'Thử gọi' })).toBeEnabled();
  });

  it('does not call when the form is invalid', async () => {
    const { fetchStub, calls } = stubFetch({});
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(panel({ build: () => null }));
    await userEvent.click(screen.getByRole('button', { name: 'Thử gọi' }));
    expect(calls).toHaveLength(0);
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
    renderWithProviders(panel({ actionId: ACTION_ID, params }));
    await userEvent.type(screen.getByLabelText('orderId'), 'A1');
    await userEvent.type(screen.getByLabelText('qty'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Thử gọi' }));
    expect(await screen.findByText('Thành công')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('120 ms')).toBeInTheDocument();
    expect(screen.getByText(/"status": "shipped"/)).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({
      action: draft,
      actionId: ACTION_ID,
      args: { orderId: 'A1', qty: 2 },
    });
  });

  it('renders a failed call with a localized reason', async () => {
    const { fetchStub } = stubFetch({
      [route]: {
        status: 200,
        body: { ok: false, statusCode: null, data: null, errorCode: 'blocked_host', latencyMs: 3 },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(panel({ actionId: ACTION_ID }));
    await userEvent.click(screen.getByRole('button', { name: 'Thử gọi' }));
    expect(await screen.findByText('Thất bại')).toBeInTheDocument();
    expect(screen.getByText('Địa chỉ không được phép gọi')).toBeInTheDocument();
  });

  it('shows an error when the request itself fails', async () => {
    const { fetchStub } = stubFetch({
      [route]: { status: 500, body: { code: 'INTERNAL', message: 'boom' } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(panel({ actionId: ACTION_ID }));
    await userEvent.click(screen.getByRole('button', { name: 'Thử gọi' }));
    await waitFor(() =>
      expect(screen.getByText('Không gọi được. Thử lại sau.')).toBeInTheDocument(),
    );
  });

  it('clears an outdated result when the form changes', async () => {
    const { fetchStub } = stubFetch({
      [route]: {
        status: 200,
        body: { ok: true, statusCode: 200, data: { a: 1 }, errorCode: null, latencyMs: 1 },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const view = renderWithProviders(panel({ key: 'one' }));
    await userEvent.click(screen.getByRole('button', { name: 'Thử gọi' }));
    expect(await screen.findByText('Thành công')).toBeInTheDocument();
    view.rerender(panel({ key: 'two' }));
    await waitFor(() => expect(screen.queryByText('Thành công')).not.toBeInTheDocument());
  });
});
