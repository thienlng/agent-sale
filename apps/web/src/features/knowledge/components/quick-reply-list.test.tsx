import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectPageContext, fillAssistantForm } from '@/lib/assistant-context';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { QuickReplyList } from './quick-reply-list';

const owner = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
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
const reply = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b01',
  botId: BOT,
  kind: 'quick_reply',
  title: 'ship',
  content: 'Phí ship 30k.',
  trigger: 'ship',
  mediaUrl: null,
  folderId: null,
  enabled: true,
  section: 'general',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

async function setup(items: unknown[] = []) {
  const stub = stubFetch({
    [`GET /bots/${BOT}`]: { status: 200, body: bot },
    [`GET /bots/${BOT}/training-items`]: { status: 200, body: { data: items } },
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => <QuickReplyList botId={BOT} />);
  await screen.findByText(
    items.length ? '/ship' : 'Không có nội dung trả lời nhanh nào',
    undefined,
    {
      timeout: 10_000,
    },
  );
  return stub;
}

const form = () =>
  collectPageContext('/app/bots/b/quick-replies').forms?.find((f) => f.id === 'quick-reply');

describe('QuickReplyList and the owner assistant', () => {
  it('describes the page and registers a closed new quick reply without the image', async () => {
    await setup();
    expect(form()?.fields).toEqual([
      { name: 'shortcut', label: 'Từ viết tắt', type: 'text', empty: true },
      { name: 'content', label: 'Nội dung', type: 'textarea', empty: true },
    ]);
    const context = collectPageContext('/app/bots/b/quick-replies');
    expect(context.title).toBe('Tin nhắn nhanh');
    expect(context.targets).toContain('quick-reply.new');
    await waitFor(() =>
      expect(collectPageContext('/x').entity).toEqual({ botId: BOT, industry: 'retail' }),
    );
  });

  it('opens the dialog with a normalised shortcut and the content, without saving', async () => {
    const stub = await setup();
    let result: ReturnType<typeof fillAssistantForm> | undefined;
    act(() => {
      result = fillAssistantForm('quick-reply', {
        shortcut: '/phi ship',
        content: 'Phí ship nội thành 30.000đ.',
        mediaUrl: 'https://x.example/a.png',
      });
    });
    expect(result).toMatchObject({ ok: true, opensDialog: true });
    expect(await screen.findByLabelText('Từ viết tắt')).toHaveValue('phiship');
    expect(screen.getByLabelText('Nội dung')).toHaveValue('Phí ship nội thành 30.000đ.');
    expect(screen.getByLabelText('Hoặc dán liên kết ảnh HTTPS')).toHaveValue('');
    await waitFor(() => expect(form()?.fields[0]?.empty).toBe(false));
    expect(stub.calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('keeps the list registration while an existing quick reply is edited', async () => {
    await setup([reply]);
    await userEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa /ship' }));
    expect(await screen.findByLabelText('Từ viết tắt')).toHaveValue('ship');
    expect(form()?.fields.every((f) => f.empty)).toBe(true);
  });

  it('offers the ask button on an empty list to the owner only', async () => {
    await setup();
    expect(screen.getByRole('button', { name: 'Nhờ trợ lý điền mẫu' })).toBeInTheDocument();
  });

  it('hides the ask button from anyone but the owner', async () => {
    owner.value = false;
    await setup();
    expect(screen.queryByRole('button', { name: 'Nhờ trợ lý điền mẫu' })).not.toBeInTheDocument();
  });
});
