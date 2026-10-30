import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { FaqDialog } from './faq-dialog';

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

const BOT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a00';

const bot = (industry: string) => ({
  id: BOT,
  name: 'Bot',
  industry,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  settings: {
    mission: '',
    greeting: '',
    selfPronoun: 'em',
    customerPronoun: 'anh/chị',
    useCustomerName: true,
    fallbackMessage: 'x',
    handoffMessage: 'x',
    creativity: 'balanced',
    modelTier: 'smart',
    language: 'vi',
    placeholders: {},
    profile: { fields: {}, notes: '' },
  },
});

async function setup(industry: string, onOpenChange = vi.fn()) {
  vi.stubGlobal(
    'fetch',
    stubFetch({ [`GET /bots/${BOT}`]: { status: 200, body: bot(industry) } }).fetchStub,
  );
  renderWithRouter(() => (
    <>
      <input id="bp-shipping" aria-label="shipping-field" />
      <FaqDialog botId={BOT} open faq={null} onOpenChange={onOpenChange} />
    </>
  ));
  return { question: await screen.findByLabelText(/Câu hỏi/, undefined, { timeout: 10_000 }) };
}

// The first render in a worker loads i18n and the dialog; give it room on a loaded host.
vi.setConfig({ testTimeout: 20_000 });

const HINT = /nên điền ở ô “Giao hàng & phí ship”/;

describe('FaqDialog profile hint', () => {
  it('points to the shipping field when a retail question mentions shipping', async () => {
    const { question } = await setup('retail');
    await userEvent.type(question, 'phí ship ra Hà Nội');
    expect(await screen.findByText(HINT, undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('shows nothing when the industry has no such field', async () => {
    const { question } = await setup('hotel');
    await userEvent.type(question, 'phí ship ra Hà Nội');
    await waitFor(() => expect(question).toHaveValue('phí ship ra Hà Nội'));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('shows nothing for a question without a profile topic', async () => {
    const { question } = await setup('retail');
    await userEvent.type(question, 'Sản phẩm này có màu gì');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('closes the dialog and focuses the field from the hint button', async () => {
    const onOpenChange = vi.fn();
    const { question } = await setup('retail', onOpenChange);
    await userEvent.type(question, 'phí ship ra Hà Nội');
    await userEvent.click(await screen.findByRole('button', { name: 'Đi tới ô này' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
