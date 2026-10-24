import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { TestChat } from './test-chat';

const botId = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d11';
const reply = {
  runId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d12',
  reply: 'Dạ shop ở 12 Lê Lợi ạ',
  outcome: 'answered',
  guardrail: null,
  sources: [
    {
      faqId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d13',
      question: 'Cửa hàng ở đâu?',
      score: 0.8,
      used: true,
    },
  ],
  usage: { inputTokens: 40, outputTokens: 12, cachedInputTokens: 0 },
  provider: 'dev-fake',
  model: 'grounded-echo',
  latencyMs: 420,
};

beforeAll(() => {
  // jsdom lacks these; the message scroller uses them for auto-scroll.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollTo ??= () => {};
});
afterEach(() => vi.unstubAllGlobals());

describe('TestChat', () => {
  it('sends the greeting + customer turn and shows the reply with its source', async () => {
    const { fetchStub, calls } = stubFetch({
      [`POST /bots/${botId}/playground`]: { status: 200, body: reply },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<TestChat botId={botId} greeting="Dạ Shop Lan xin chào ạ!" />);

    await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'shop o dau vay{Enter}');

    expect(await screen.findByText('Dạ shop ở 12 Lê Lợi ạ')).toBeInTheDocument();
    expect(screen.getByText('Trả lời từ FAQ: Cửa hàng ở đâu?')).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({
      messages: [
        { role: 'bot', content: 'Dạ Shop Lan xin chào ạ!' },
        { role: 'customer', content: 'shop o dau vay' },
      ],
    });
  });

  it('explains a missing AI configuration instead of failing silently', async () => {
    const { fetchStub } = stubFetch({
      [`POST /bots/${botId}/playground`]: {
        status: 503,
        body: {
          error: { code: 'AI_UNAVAILABLE', message: 'No AI model is configured for this tier' },
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(
      <TestChat botId={botId} greeting="" suggestions={['Phí ship bao nhiêu?']} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Phí ship bao nhiêu?' }));
    expect(
      await screen.findByText('Chưa cấu hình mô hình AI cho gói này. Liên hệ quản trị hệ thống.'),
    ).toBeInTheDocument();
  });

  it('offers the FAQ starters only while empty and resets the conversation', async () => {
    const { fetchStub } = stubFetch({
      [`POST /bots/${botId}/playground`]: { status: 200, body: reply },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(
      <TestChat botId={botId} greeting="" suggestions={['Cửa hàng ở đâu?', 'Giờ mở cửa?']} />,
    );
    expect(
      screen.getByText('Xem cách Bot phản hồi những câu hỏi thường gặp này'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cửa hàng ở đâu?' }));
    expect(await screen.findByText('Dạ shop ở 12 Lê Lợi ạ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Giờ mở cửa?' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Làm mới đoạn chat' }));
    expect(screen.queryByText('Dạ shop ở 12 Lê Lợi ạ')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Giờ mở cửa?' })).toBeInTheDocument();
  });
});
