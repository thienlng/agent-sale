import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/lib/session';
import {
  ASSISTANT_IDS,
  runFixture,
  threadFixture,
  turnFixture,
} from '@/testing/assistant-factories';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { useAssistantUi } from '../stores/assistant-ui.store';
import { AssistantBubble } from './assistant-bubble';

const ACCOUNT = '0b9c3a52-5e3f-4c55-9a51-6a0f4b7d2c01';
const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => WS }));
vi.mock('@/lib/session', () => ({
  useSession: (): Session => ({
    user: { id: 'u1' } as Session['user'],
    accounts: [{ accountId: ACCOUNT, name: 'Shop An', role: 'owner' }],
    memberships: [
      {
        workspaceId: WS,
        workspaceName: 'Shop An',
        role: 'owner',
        industry: 'retail',
        accountId: ACCOUNT,
        accountName: 'Shop An',
      },
    ],
    workspaceId: WS,
  }),
}));

/** The app layout in small: any page, with the bubble after the outlet (routes/app.tsx). */
function renderApp(page: () => React.ReactElement = () => <p>page</p>, path = '/app/orders') {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <AssistantBubble />
      </>
    ),
  });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: page });
  const router = createRouter({
    routeTree: root.addChildren([any]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  renderWithProviders(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  useAssistantUi.setState({ open: false, workspaceId: null, threadId: null, spotlight: null });
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(ASSISTANT_IDS.turn);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  toast.mockClear();
  toast.error.mockClear();
});

describe('AssistantPanel', () => {
  it('starts over when the business changed: no stale thread, no spotlight', async () => {
    useAssistantUi.setState({
      open: true,
      workspaceId: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
      threadId: ASSISTANT_IDS.thread,
      spotlight: { target: 'orders.new', hint: 'Ở đây' },
    });
    const { fetchStub, calls } = stubFetch({});
    vi.stubGlobal('fetch', fetchStub);
    renderApp();

    expect(await screen.findByText('Mình là Thỏ Rapiz')).toBeInTheDocument();
    expect(useAssistantUi.getState()).toMatchObject({
      workspaceId: WS,
      threadId: null,
      spotlight: null,
    });
    // The other business's thread is never fetched under this one.
    expect(calls).toHaveLength(0);
  });

  it('sends the message with the page context, renders the answer and navigates', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [`POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: turnFixture('mở trang sản phẩm', {
          content: 'Đây là trang sản phẩm.',
          uiActions: [{ type: 'navigate', to: '/app/products' }],
        }),
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      'GET /assistant/threads': { status: 200, body: { data: [threadFixture()] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const router = renderApp(() => <button data-assistant-target="orders.new">Tạo đơn</button>);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    const box = await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' });
    await user.type(box, 'mở trang sản phẩm{Enter}');

    expect(await screen.findByText('Đây là trang sản phẩm.')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/products'));
    const sent = calls.find((c) => c.key.endsWith('/messages'));
    expect(sent?.body).toEqual({
      turnId: ASSISTANT_IDS.turn,
      text: 'mở trang sản phẩm',
      pageContext: { route: '/app/orders', targets: ['orders.new'] },
    });
    expect(screen.getByText('mở trang sản phẩm')).toBeInTheDocument();
  });

  it('ignores a navigate action that leaves the dashboard', async () => {
    const { fetchStub } = stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [`POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: turnFixture('đi', {
          content: 'Đi thôi.',
          uiActions: [{ type: 'navigate', to: '/app/%2e%2e/login' }],
        }),
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      'GET /assistant/threads': { status: 200, body: { data: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const router = renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    await user.type(await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' }), 'đi{Enter}');

    expect(await screen.findByText('Đi thôi.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app/orders');
  });

  it('says the assistant is busy (409) and unavailable (503)', async () => {
    const send = `POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`;
    const routes: Parameters<typeof stubFetch>[0] = {
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [send]: {
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'busy', traceId: 't' } },
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: { data: [] },
      },
      'GET /assistant/threads': { status: 200, body: { data: [] } },
    };
    const { fetchStub } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    const box = await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' });
    await user.type(box, 'xin chào{Enter}');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Thỏ Rapiz đang trả lời câu trước, đợi chút nhé.'),
    );
    // The text comes back so the owner can send it again.
    expect(box).toHaveValue('xin chào');

    routes[send] = {
      status: 503,
      body: { error: { code: 'AI_UNAVAILABLE', message: 'down', traceId: 't' } },
    };
    await user.clear(box);
    await user.type(box, 'lần nữa{Enter}');
    expect(
      await screen.findByText('Thỏ Rapiz tạm thời không trả lời được. Thử lại sau ít phút.'),
    ).toBeInTheDocument();
  });
});
