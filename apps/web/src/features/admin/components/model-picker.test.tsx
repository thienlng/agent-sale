import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { ModelPicker } from './model-picker';

const id = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10';
const path = `GET /admin/llm/providers/${id}/models`;

beforeAll(() => {
  // jsdom lacks the pointer APIs Radix Select relies on.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => vi.unstubAllGlobals());

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <ModelPicker providerId={id} label="Model" value={value} onChange={setValue} />;
}

function setup(routes: Parameters<typeof stubFetch>[0], initial?: string) {
  const stub = stubFetch(routes);
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithProviders(<Harness {...(initial ? { initial } : {})} />);
  return stub;
}

describe('ModelPicker', () => {
  it('offers the fetched models, keeps an unlisted saved value, and picks', async () => {
    setup(
      {
        [path]: {
          status: 200,
          body: { state: 'ok', data: [{ id: 'gpt-6-sol' }, { id: 'gpt-6' }] },
        },
      },
      'legacy-model',
    );
    const trigger = await screen.findByRole('combobox', { name: 'Model' });
    expect(trigger).toHaveTextContent('legacy-model');
    await userEvent.click(trigger);
    expect(await screen.findByRole('option', { name: 'legacy-model' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'gpt-6-sol' }));
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('gpt-6-sol');
  });

  it('auth_required: shows the sign-in hint and still allows typing', async () => {
    setup({ [path]: { status: 200, body: { state: 'auth_required', data: [] } } });
    expect(
      await screen.findByText('Đăng nhập ChatGPT để lấy danh sách mô hình'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Model' }), 'abc');
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('abc');
  });

  it('unavailable or empty: falls back to free text with a note', async () => {
    setup({ [path]: { status: 200, body: { state: 'unavailable', data: [] } } });
    expect(await screen.findByText(/Không lấy được danh sách mô hình/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Model' })).toBeInTheDocument();
  });

  it('refresh re-requests the list', async () => {
    const { calls } = setup({
      [path]: { status: 200, body: { state: 'ok', data: [{ id: 'a' }] } },
    });
    await screen.findByRole('combobox', { name: 'Model' });
    await userEvent.click(screen.getByRole('button', { name: 'Làm mới danh sách mô hình' }));
    await vi.waitFor(() => expect(calls.filter((c) => c.key === path)).toHaveLength(2));
  });
});
