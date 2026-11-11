import type { TaskDto, TodayItem, TodayResponse } from '@agent-sales/contracts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import type { Session } from '@/lib/session';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { TodayPage } from './today-page';

const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const ME = '0190f5c2-0000-7000-8000-0000000000b1';
const CONV = '0190f5c2-0000-7000-8000-00000000c001';
const CONV2 = '0190f5c2-0000-7000-8000-00000000c002';
const TASK = '0190f5c2-0000-7000-8000-00000000f001';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => WS }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
vi.mock('@/lib/session', () => ({
  useSession: (): Session =>
    ({ user: { id: ME }, workspaceId: WS, memberships: [], accounts: [] }) as unknown as Session,
}));

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function item(over: Partial<TodayItem> = {}): TodayItem {
  return {
    conversationId: CONV,
    contactId: null,
    customerName: 'Chị Lan',
    avatarUrl: null,
    channel: 'facebook',
    reason: 'Giao sai màu áo',
    stage: 'ready',
    mood: 'complaint',
    at: ago(30),
    assigneeId: null,
    assigneeName: null,
    stageLocked: false,
    ...over,
  };
}

function task(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: TASK,
    title: 'Gọi lại chị Mai',
    note: null,
    dueAt: ago(60),
    assigneeUserId: ME,
    assigneeName: 'Tôi',
    status: 'open',
    contactId: null,
    conversationId: null,
    subjectType: null,
    subjectId: null,
    source: 'manual',
    createdAt: ago(600),
    doneAt: null,
    version: 1,
    ...over,
  };
}

function today(over: Partial<TodayResponse> = {}): TodayResponse {
  return {
    queues: [
      { key: 'attention', count: 1, items: [item()] },
      {
        key: 'unanswered',
        count: 1,
        items: [item({ conversationId: CONV2, customerName: 'Anh Minh', reason: '' })],
      },
      { key: 'ready', count: 0, items: [] },
      { key: 'price_silent', count: 0, items: [] },
      { key: 'follow_up', count: 0, items: [] },
      { key: 'tasks', count: 1, items: [task()] },
    ],
    usage: { used: 3, limit: 200 },
    mode: 'auto',
    generatedAt: new Date().toISOString(),
    ...over,
  };
}

/** Today plus an inbox page that shows the search it was opened with. */
function renderApp() {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/app/today',
    component: TodayPage,
  });
  const inbox = createRoute({
    getParentRoute: () => root,
    path: '/app/inbox',
    component: () => <p>inbox</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([page, inbox]),
    history: createMemoryHistory({ initialEntries: ['/app/today'] }),
  });
  renderWithProviders(<RouterProvider router={router} />);
  return router;
}

beforeAll(async () => {
  await loadNamespace('brain');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TodayPage', () => {
  it('renders the queues with their counts, items and empty states', async () => {
    vi.stubGlobal('fetch', stubFetch({ 'GET /today': { status: 200, body: today() } }).fetchStub);
    renderApp();

    const attention = await screen.findByRole('region', { name: 'Phàn nàn / cần người' });
    expect(within(attention).getByText('Chị Lan')).toBeInTheDocument();
    expect(within(attention).getByText('Giao sai màu áo')).toBeInTheDocument();
    expect(within(attention).getByText('Sắp chốt')).toBeInTheDocument();
    const unanswered = screen.getByRole('region', { name: 'Chưa trả lời' });
    expect(within(unanswered).getByText('Anh Minh')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Sắp chốt' })).getByText(
        'Chưa có khách nào sắp chốt.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Việc của tôi' })).getByText('Gọi lại chị Mai'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Làm mới \(còn 197 lượt\)/ })).toBeEnabled();
    expect(screen.queryByText(/Đã hết lượt đánh giá hôm nay/)).toBeNull();
  });

  it('shows the cap banner and disables refresh when the evaluations are used up', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        'GET /today': { status: 200, body: today({ usage: { used: 200, limit: 200 } }) },
      }).fetchStub,
    );
    renderApp();
    expect(
      await screen.findByText('Đã hết lượt đánh giá hôm nay — các mục chỉ dựa trên dữ liệu có sẵn'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Làm mới \(còn 0 lượt\)/ })).toBeDisabled();
  });

  it('dismisses an item: it leaves the queue at once', async () => {
    const routes: Parameters<typeof stubFetch>[0] = {
      'GET /today': { status: 200, body: today() },
      [`POST /today/items/${CONV}/dismiss`]: { status: 204 },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();
    const attention = await screen.findByRole('region', { name: 'Phàn nàn / cần người' });
    await user.click(within(attention).getByRole('button', { name: 'Thao tác khác cho Chị Lan' }));
    // The server's next Today no longer lists the customer.
    const after = today();
    after.queues[0] = { key: 'attention', count: 0, items: [] };
    routes['GET /today'] = { status: 200, body: after };
    await user.click(await screen.findByRole('menuitem', { name: 'Bỏ qua' }));

    await waitFor(() => expect(within(attention).queryByText('Chị Lan')).toBeNull());
    expect(calls.some((c) => c.key === `POST /today/items/${CONV}/dismiss`)).toBe(true);
  });

  it('drafts a reply and opens the inbox with the draft', async () => {
    const draft = 'Dạ shop xin lỗi chị, shop đổi áo ngay ạ.';
    vi.stubGlobal(
      'fetch',
      stubFetch({
        'GET /today': { status: 200, body: today() },
        [`POST /conversations/${CONV}/reply-draft`]: { status: 200, body: { text: draft } },
      }).fetchStub,
    );
    const router = renderApp();
    const user = userEvent.setup();
    const attention = await screen.findByRole('region', { name: 'Phàn nàn / cần người' });
    await user.click(within(attention).getByRole('button', { name: 'Soạn trả lời' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/inbox'));
    expect(router.state.location.search).toEqual({ conversation: CONV, draft });
  });

  it('creates a task for a customer and completes a task', async () => {
    const created = task({ id: '0190f5c2-0000-7000-8000-00000000f002', conversationId: CONV });
    const routes: Parameters<typeof stubFetch>[0] = {
      'GET /today': { status: 200, body: today() },
      'POST /tasks': { status: 201, body: created },
      [`POST /tasks/${TASK}/complete`]: { status: 200, body: task({ status: 'done' }) },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();
    const attention = await screen.findByRole('region', { name: 'Phàn nàn / cần người' });
    await user.click(within(attention).getByRole('button', { name: 'Thêm việc' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Việc cần làm')).toHaveValue('Liên hệ lại Chị Lan');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm việc' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /tasks')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /tasks')?.body).toMatchObject({
      title: 'Liên hệ lại Chị Lan',
      conversationId: CONV,
      assigneeUserId: ME,
      source: 'today',
    });

    const tasks = screen.getByRole('region', { name: 'Việc của tôi' });
    const done = today();
    done.queues[5] = { key: 'tasks', count: 0, items: [] };
    routes['GET /today'] = { status: 200, body: done };
    await user.click(
      within(tasks).getByRole('checkbox', { name: 'Đánh dấu xong: Gọi lại chị Mai' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.key === `POST /tasks/${TASK}/complete`)).toBe(true),
    );
    await waitFor(() => expect(within(tasks).queryByText('Gọi lại chị Mai')).toBeNull());
  });

  it('explains manual mode', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ 'GET /today': { status: 200, body: today({ mode: 'manual' }) } }).fetchStub,
    );
    renderApp();
    expect(await screen.findByText(/Chỉ khi tôi bấm/)).toBeInTheDocument();
  });
});
