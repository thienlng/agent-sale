import type { LlmProviderDto } from '@agent-sales/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { TestProviderButton } from './test-provider-button';

const id = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10';
const provider = { id, name: 'hermes', kind: 'hermes' } as LlmProviderDto;
const models = {
  state: 'ok',
  data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-sol' }],
};
const target = (model: string) => ({ providerId: id, model, effort: null });

afterEach(() => vi.unstubAllGlobals());

async function open(tiers: unknown[]) {
  const stub = stubFetch({
    [`GET /admin/llm/providers/${id}/models`]: { status: 200, body: models },
    'GET /admin/llm/tiers': { status: 200, body: { data: tiers } },
    [`POST /admin/llm/providers/${id}/test`]: {
      status: 200,
      body: { ok: true, latencyMs: 12, model: 'x', error: null },
    },
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithProviders(<TestProviderButton provider={provider} />);
  await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
  return stub;
}

describe('TestProviderButton', () => {
  it('defaults to the first listed model when nothing is routed', async () => {
    const { calls } = await open([]);
    const trigger = await screen.findByRole('combobox', { name: 'Mô hình để kiểm tra' });
    expect(trigger).toHaveTextContent('gpt-6.1-sol');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Kiểm tra' }).at(-1) as HTMLElement,
    );
    await vi.waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('POST'))?.body).toEqual({ model: 'gpt-6.1-sol' }),
    );
  });

  it('defaults to the model routed for this provider', async () => {
    await open([
      {
        tier: 'smart',
        primary: target('gpt-6-sol'),
        fallback: null,
        updatedAt: '2026-10-24T10:00:00.000Z',
      },
    ]);
    await vi.waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Mô hình để kiểm tra' })).toHaveTextContent(
        /^gpt-6-sol$/,
      ),
    );
  });
});
