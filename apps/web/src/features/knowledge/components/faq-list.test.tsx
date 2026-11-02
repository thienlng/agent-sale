import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectPageContext, fillAssistantForm } from '@/lib/assistant-context';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { FaqList } from './faq-list';

const owner = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
vi.mock('@/lib/use-is-account-owner', () => ({ useIsAccountOwner: () => owner.value }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
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
beforeEach(() => {
  owner.value = true;
});
afterEach(() => vi.unstubAllGlobals());

const BOT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a00';
const bot = {
  id: BOT,
  name: 'Bot',
  industry: 'retail',
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
};
const faq = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01',
  botId: BOT,
  question: 'Shop mở cửa mấy giờ?',
  answer: 'Từ 8h đến 22h.',
  source: 'manual',
  missingPlaceholders: [],
  updatedAt: '2026-10-01T00:00:00.000Z',
};

async function setup(faqs: unknown[] = []) {
  const stub = stubFetch({
    [`GET /bots/${BOT}`]: { status: 200, body: bot },
    [`GET /bots/${BOT}/faqs`]: { status: 200, body: { data: faqs } },
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => <FaqList botId={BOT} />);
  await screen.findByText(faqs.length ? `- ${faq.question}` : /Chưa có câu hỏi/, undefined, {
    timeout: 10_000,
  });
  return stub;
}

const faqForm = () =>
  collectPageContext('/app/bots/b/knowledge').forms?.find((f) => f.id === 'faq');

describe('FaqList and the owner assistant', () => {
  it('describes the page and registers the closed add dialog with empty fields', async () => {
    await setup();
    const context = collectPageContext('/app/bots/b/knowledge');
    expect(context).toMatchObject({
      title: 'Thông tin & FAQ',
      entity: { botId: BOT, industry: 'retail' },
    });
    expect(context.targets).toContain('faq.new');
    expect(faqForm()?.fields).toEqual([
      { name: 'question', label: 'Câu hỏi của khách', type: 'textarea', empty: true },
      { name: 'answer', label: 'Câu trả lời của bot', type: 'textarea', empty: true },
    ]);
  });

  it('opens the add dialog with the draft, and never saves it', async () => {
    const stub = await setup();
    let result: ReturnType<typeof fillAssistantForm> | undefined;
    act(() => {
      result = fillAssistantForm('faq', { question: 'Có giao hàng không?', answer: 'Có ạ.' });
    });
    expect(result).toEqual({ ok: true, submitTarget: undefined, opensDialog: true });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Thêm câu hỏi');
    expect(screen.getByLabelText('Câu hỏi của khách')).toHaveValue('Có giao hàng không?');
    expect(screen.getByLabelText('Câu trả lời của bot')).toHaveValue('Có ạ.');
    // The open dialog now holds the form: a second fill sets its own fields.
    await waitFor(() => expect(faqForm()?.fields[0]?.empty).toBe(false));
    act(() => {
      result = fillAssistantForm('faq', { answer: 'Có, toàn quốc.' });
    });
    expect(result).toEqual({ ok: true, submitTarget: undefined, opensDialog: false });
    expect(screen.getByLabelText('Câu trả lời của bot')).toHaveValue('Có, toàn quốc.');
    expect(screen.getByLabelText('Câu hỏi của khách')).toHaveValue('Có giao hàng không?');
    expect(stub.calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('keeps the list registration while an existing FAQ is edited', async () => {
    await setup([faq]);
    await userEvent.click(screen.getByText(`- ${faq.question}`));
    expect(await screen.findByLabelText('Câu hỏi của khách')).toHaveValue(faq.question);
    expect(faqForm()?.fields.every((f) => f.empty)).toBe(true);
  });

  it('offers the ask button in the empty FAQ list and the incomplete profile', async () => {
    await setup();
    const empty = screen.getByText(/Chưa có câu hỏi/).parentElement as HTMLElement;
    expect(within(empty).getByRole('button', { name: 'Nhờ trợ lý điền mẫu' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Nhờ trợ lý điền mẫu' })).toHaveLength(2),
    );
  });

  it('hides the ask buttons from anyone but the owner', async () => {
    owner.value = false;
    await setup();
    await screen.findByText(/^Đã điền 0\//);
    expect(screen.queryByRole('button', { name: 'Nhờ trợ lý điền mẫu' })).not.toBeInTheDocument();
  });
});
