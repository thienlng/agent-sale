import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { ASSISTANT_IDS, threadFixture } from '@/testing/assistant-factories';
import { renderWithProviders } from '@/testing/render';

import { AssistantThreadList } from './assistant-thread-list';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => loadNamespace('assistant'));
afterEach(() => {
  vi.unstubAllGlobals();
  toast.success.mockClear();
  toast.error.mockClear();
});

const ORDERS = threadFixture({ title: 'Hỏi về đơn hàng' });
const BOT = threadFixture({ id: ASSISTANT_IDS.thread2, title: 'Cài đặt bot' });
const ARCHIVED_ID = '0193b000-0000-7000-8000-000000000003';
const THREAD = `/assistant/threads/${ASSISTANT_IDS.thread}`;
const ARCHIVED = `/assistant/threads/${ARCHIVED_ID}`;
/** The first render lazy-loads the list and its namespace: give it more than the 1 s default. */
const listed = (title: string) => screen.findByRole('button', { name: title }, { timeout: 5000 });
const menuOf = (title: string) => screen.getByRole('button', { name: `Tuỳ chọn cho “${title}”` });

/**
 * A small stateful server: PATCH changes the stored thread, so the list refetched after a
 * mutation shows the change (as the real API does). `fail` answers one route with an error.
 */
function setup(fail: Record<string, { status: number; body: unknown }> = {}) {
  const store = new Map(
    [ORDERS, BOT, threadFixture({ id: ARCHIVED_ID, title: 'Báo giá cũ', archived: true })].map(
      (t) => [t.id, { ...t }],
    ),
  );
  const calls: Array<{ key: string; body: unknown }> = [];
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetchStub = async (input: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${input.replace('/api/v1', '')}`;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const failure = fail[key];
    if (failure) return json(failure.status, failure.body);
    if (key === 'GET /assistant/threads' || key === 'GET /assistant/threads?archived=true') {
      const archived = key.endsWith('archived=true');
      return json(200, { data: [...store.values()].filter((t) => t.archived === archived) });
    }
    const match = /^(PATCH|DELETE) \/assistant\/threads\/([\w-]+)$/.exec(key);
    const thread = match ? store.get(match[2] ?? '') : undefined;
    if (!match || !thread) throw new Error(`unexpected request ${key}`);
    if (match[1] === 'DELETE') {
      store.delete(thread.id);
      return json(204);
    }
    Object.assign(thread, body);
    return json(200, thread);
  };
  vi.stubGlobal('fetch', fetchStub);
  const onPick = vi.fn();
  const onCurrentRemoved = vi.fn();
  renderWithProviders(
    <AssistantThreadList
      currentId={ASSISTANT_IDS.thread}
      onPick={onPick}
      onCurrentRemoved={onCurrentRemoved}
    />,
  );
  return { calls, onPick, onCurrentRemoved, user: userEvent.setup() };
}

describe('AssistantThreadList menu', () => {
  it('puts the menu beside the pick button, not inside it', async () => {
    setup();
    const pick = await listed('Hỏi về đơn hàng');
    const menu = menuOf('Hỏi về đơn hàng');
    expect(pick.contains(menu)).toBe(false);
    expect(menu.closest('button')).toBe(menu);
    expect(menu.parentElement).toBe(pick.parentElement);
    expect(menu).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('renames a thread inline: Enter saves, Escape keeps the old title', async () => {
    const { calls, user } = setup();
    await listed('Hỏi về đơn hàng');

    await user.click(menuOf('Hỏi về đơn hàng'));
    await user.click(await screen.findByRole('menuitem', { name: 'Đổi tên' }));
    let field = screen.getByRole('textbox', { name: 'Tên cuộc trò chuyện' });
    expect(field).toHaveValue('Hỏi về đơn hàng');
    expect(field).toHaveAttribute('maxLength', '120');
    await waitFor(() => expect(field).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Tên cuộc trò chuyện' })).toBeNull();
    expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);

    await user.click(menuOf('Hỏi về đơn hàng'));
    await user.click(await screen.findByRole('menuitem', { name: 'Đổi tên' }));
    field = screen.getByRole('textbox', { name: 'Tên cuộc trò chuyện' });
    await waitFor(() => expect(field).toHaveFocus());
    await user.clear(field);
    await user.type(field, '  Đơn tuần này {Enter}');

    expect(await screen.findByRole('button', { name: 'Đơn tuần này' })).toBeInTheDocument();
    expect(calls.filter((c) => c.key === `PATCH ${THREAD}`).map((c) => c.body)).toEqual([
      { title: 'Đơn tuần này' },
    ]);
  });

  it('pins a thread and archives the current one, then opens a fresh chat', async () => {
    const { calls, user, onCurrentRemoved } = setup();
    await listed('Hỏi về đơn hàng');

    await user.click(menuOf('Hỏi về đơn hàng'));
    await user.click(await screen.findByRole('menuitem', { name: 'Ghim' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === `PATCH ${THREAD}`).map((c) => c.body)).toEqual([
        { pinned: true },
      ]),
    );
    expect(onCurrentRemoved).not.toHaveBeenCalled();

    await user.click(menuOf('Hỏi về đơn hàng'));
    expect(await screen.findByRole('menuitem', { name: 'Bỏ ghim' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Lưu trữ' }));
    await waitFor(() => expect(onCurrentRemoved).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c.key === `PATCH ${THREAD}`).map((c) => c.body)).toEqual([
      { pinned: true },
      { archived: true },
    ]);
    expect(toast.success).toHaveBeenCalledWith('Đã lưu trữ cuộc trò chuyện');
  });

  it('deletes only after the confirm, and a fresh chat replaces the deleted current one', async () => {
    const { calls, user, onCurrentRemoved } = setup();
    await listed('Hỏi về đơn hàng');

    await user.click(menuOf('Hỏi về đơn hàng'));
    await user.click(await screen.findByRole('menuitem', { name: 'Xoá' }));
    let alert = await screen.findByRole('alertdialog');
    expect(alert).toHaveTextContent('“Hỏi về đơn hàng” cùng mọi tin nhắn');
    await user.click(within(alert).getByRole('button', { name: 'Huỷ' }));
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);

    await user.click(menuOf('Hỏi về đơn hàng'));
    await user.click(await screen.findByRole('menuitem', { name: 'Xoá' }));
    alert = await screen.findByRole('alertdialog');
    await user.click(within(alert).getByRole('button', { name: 'Xoá' }));

    await waitFor(() => expect(onCurrentRemoved).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c.key === `DELETE ${THREAD}`)).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Hỏi về đơn hàng' })).toBeNull(),
    );
    expect(toast.success).toHaveBeenCalledWith('Đã xoá cuộc trò chuyện');
  });

  it('says the assistant is still answering when the delete is refused (409 thread_running)', async () => {
    const { user, onCurrentRemoved } = setup({
      [`DELETE /assistant/threads/${ASSISTANT_IDS.thread2}`]: {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'busy',
            details: { reason: 'thread_running' },
          },
        },
      },
    });
    await listed('Cài đặt bot');
    await user.click(menuOf('Cài đặt bot'));
    await user.click(await screen.findByRole('menuitem', { name: 'Xoá' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Xoá' }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Trợ lý đang trả lời trong cuộc trò chuyện này. Thử lại khi xong nhé.',
      ),
    );
    expect(onCurrentRemoved).not.toHaveBeenCalled();
  });

  it('lists archived threads with Bỏ lưu trữ and Xoá, and goes back', async () => {
    const { calls, user } = setup();
    await listed('Hỏi về đơn hàng');

    await user.click(screen.getByRole('button', { name: 'Đã lưu trữ' }));
    expect(await screen.findByRole('button', { name: 'Báo giá cũ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cài đặt bot' })).toBeNull();

    await user.click(menuOf('Báo giá cũ'));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Bỏ lưu trữ', 'Xoá']);
    await user.click(screen.getByRole('menuitem', { name: 'Bỏ lưu trữ' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === `PATCH ${ARCHIVED}`).map((c) => c.body)).toEqual([
        { archived: false },
      ]),
    );
    expect(toast.success).toHaveBeenCalledWith('Đã đưa cuộc trò chuyện trở lại danh sách');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Báo giá cũ' })).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Quay lại cuộc trò chuyện' }));
    expect(await screen.findByRole('button', { name: 'Cài đặt bot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Báo giá cũ' })).toBeInTheDocument();
  });

  it('opens the menu from the keyboard', async () => {
    const { user } = setup();
    await listed('Hỏi về đơn hàng');
    menuOf('Cài đặt bot').focus();
    await user.keyboard('{Enter}');
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Đổi tên', 'Ghim', 'Lưu trữ', 'Xoá']);
  });
});
