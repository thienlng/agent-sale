import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { MessageUsageBanner } from './message-usage-banner';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());

const usage = (over: Record<string, unknown> = {}) => ({
  metered: true,
  used: 10,
  limit: 100,
  cycleStart: '2026-10-01T00:00:00.000Z',
  cycleEnd: '2026-10-31T00:00:00.000Z',
  exhausted: false,
  ...over,
});

async function setup(body: ReturnType<typeof usage>) {
  const stub = stubFetch({ 'GET /billing/usage': { status: 200, body } });
  vi.stubGlobal('fetch', stub.fetchStub);
  const view = renderWithProviders(<MessageUsageBanner />);
  await vi.waitFor(() => expect(stub.calls).toHaveLength(1), { timeout: 10_000 });
  return view;
}

describe('MessageUsageBanner', () => {
  it('tells staff that bots hand customers over once the allowance is spent', async () => {
    await setup(usage({ used: 100, exhausted: true }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Đã dùng hết tin nhắn AI của chu kỳ này');
    expect(alert).toHaveTextContent(/chuyển khách cho nhân viên/);
    expect(alert).toHaveTextContent(/100 tin nhắn/);
  });

  it('warns from 80% of the allowance', async () => {
    await setup(usage({ used: 80 }));
    expect(await screen.findByRole('status')).toHaveTextContent('80/100');
  });

  it('stays hidden below 80%', async () => {
    const { container } = await setup(usage({ used: 79 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden for a business without an account yet', async () => {
    const { container } = await setup(usage({ metered: false, used: 0, limit: 0 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });
});
