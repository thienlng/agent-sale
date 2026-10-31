import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { TestChat } from './test-chat';

const botId = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';
const base = {
  runId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d22',
  outcome: 'answered',
  guardrail: null,
  images: [],
  sources: [],
  usage: { inputTokens: 40, outputTokens: 12, cachedInputTokens: 0 },
  provider: 'dev-fake',
  model: 'grounded-echo',
  latencyMs: 420,
};
const quickReplies = [
  { title: '✅ Đặt hàng', payload: 'ORDER_CONFIRM' },
  { title: '✏️ Sửa thông tin', payload: 'ORDER_EDIT' },
];
const summary = {
  ...base,
  reply: 'Dạ em gửi lại đơn ạ.\nTổng: 400.000đ',
  messages: [
    { text: 'Dạ em gửi lại đơn ạ.', images: [], via: 'send_message' },
    { text: 'Tổng: 400.000đ', images: [], via: 'final', quickReplies },
  ],
};
const confirmed = {
  ...base,
  reply: 'Dạ em đã ghi nhận đơn ạ.',
  messages: [{ text: 'Dạ em đã ghi nhận đơn ạ.', images: [], via: 'final' }],
};

/** Answers each playground call with the next body and records what was sent. */
function queueFetch(bodies: unknown[]) {
  const sent: unknown[] = [];
  const fetchStub = async (_input: string, init: RequestInit = {}) => {
    sent.push(init.body ? JSON.parse(String(init.body)) : undefined);
    const body = bodies.shift();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchStub, sent };
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollTo ??= () => {};
});
afterEach(() => vi.unstubAllGlobals());

const pill = (name: string) => screen.queryByRole('button', { name });

describe('TestChat quick replies', () => {
  it('shows the pills under the last bubble of the newest bot message', async () => {
    const { fetchStub } = queueFetch([summary]);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<TestChat botId={botId} greeting="" />);
    await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'chot don{Enter}');

    const last = await screen.findByText('Tổng: 400.000đ');
    const group = screen.getByRole('group', { name: 'Trả lời nhanh' });
    expect(pill('✅ Đặt hàng')).toBeInTheDocument();
    expect(pill('✏️ Sửa thông tin')).toBeInTheDocument();
    expect(last.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sends the title as the next customer message and removes the pills', async () => {
    const { fetchStub, sent } = queueFetch([summary, confirmed]);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<TestChat botId={botId} greeting="" />);
    await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'chot don{Enter}');

    await userEvent.click(await screen.findByRole('button', { name: '✅ Đặt hàng' }));

    expect(await screen.findByText('Dạ em đã ghi nhận đơn ạ.')).toBeInTheDocument();
    expect(pill('✅ Đặt hàng')).not.toBeInTheDocument();
    expect(pill('✏️ Sửa thông tin')).not.toBeInTheDocument();
    expect(sent[1]).toEqual({
      messages: [
        { role: 'customer', content: 'chot don' },
        { role: 'bot', content: summary.reply },
        { role: 'customer', content: '✅ Đặt hàng' },
      ],
    });
  });

  it('keeps pills only on the newest bot message', async () => {
    const { fetchStub } = queueFetch([summary, summary]);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<TestChat botId={botId} greeting="" />);
    const box = screen.getByLabelText('Nhập tin nhắn của bạn');
    await userEvent.type(box, 'chot don{Enter}');
    await screen.findByRole('button', { name: '✅ Đặt hàng' });
    await userEvent.type(box, 'doi dia chi{Enter}');

    await waitFor(() => expect(screen.getAllByText('Tổng: 400.000đ')).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: '✅ Đặt hàng' })).toHaveLength(1);
    const [, newest] = screen.getAllByText('Tổng: 400.000đ');
    expect(
      newest!.compareDocumentPosition(pill('✅ Đặt hàng')!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('hides the pills once the customer types instead', async () => {
    const { fetchStub } = queueFetch([summary, confirmed]);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<TestChat botId={botId} greeting="" />);
    const box = screen.getByLabelText('Nhập tin nhắn của bạn');
    await userEvent.type(box, 'chot don{Enter}');
    await screen.findByRole('button', { name: '✅ Đặt hàng' });
    await userEvent.type(box, 'ok dat luon{Enter}');
    expect(await screen.findByText('Dạ em đã ghi nhận đơn ạ.')).toBeInTheDocument();
    expect(pill('✅ Đặt hàng')).not.toBeInTheDocument();
  });
});
