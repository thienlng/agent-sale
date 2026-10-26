import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { ModelPicker } from './model-picker';

const PROVIDER = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';

function Harness({ canList = true }: { canList?: boolean }) {
  const [model, setModel] = useState('');
  return (
    <ModelPicker
      id="m"
      label="Model"
      providerId={PROVIDER}
      value={model}
      onChange={setModel}
      canList={canList}
    />
  );
}

describe('ModelPicker', () => {
  it('fetches the provider models and fills the field from the list', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /admin/llm/providers/models': {
        status: 200,
        body: { ok: true, latencyMs: 12, models: ['llama-3.3-70b', 'qwen3-32b'], error: null },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: /danh sách mô hình/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'qwen3-32b' }));

    expect(calls[0]?.body).toEqual({ providerId: PROVIDER });
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('qwen3-32b');
  });

  it('shows the provider error and keeps typing possible', async () => {
    const { fetchStub } = stubFetch({
      'POST /admin/llm/providers/models': {
        status: 200,
        body: { ok: false, latencyMs: 5, models: [], error: '401 Incorrect API key' },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: /danh sách mô hình/i }));
    expect(await screen.findByText(/401 Incorrect API key/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Model' }), 'my-model');
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('my-model');
  });

  it('has no fetch button for servers that cannot list models', () => {
    renderWithProviders(<Harness canList={false} />);
    expect(screen.queryByRole('button', { name: /danh sách mô hình/i })).not.toBeInTheDocument();
  });
});
