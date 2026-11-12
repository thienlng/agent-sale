import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import type { Session } from '@/lib/session';
import {
  ASSISTANT_IDS,
  messageFixture,
  runFixture,
  threadFixture,
  turnFixture,
} from '@/testing/assistant-factories';
import { renderWithProviders, stubFetch as baseStubFetch } from '@/testing/render';

import { useAssistantUi } from '../stores/assistant-ui.store';
import { AssistantBubble } from './assistant-bubble';
import { AssistantPage } from './assistant-page';

const ACCOUNT = '0b9c3a52-5e3f-4c55-9a51-6a0f4b7d2c01';
const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
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

const THREAD_MESSAGES = `GET /assistant/threads/${ASSISTANT_IDS.thread}/messages`;
const THREAD_PROPOSALS = `GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`;

function stubFetch(routes: Parameters<typeof baseStubFetch>[0]) {
  return baseStubFetch({
    'GET /assistant/learning': { status: 200, body: { items: [] } },
    'GET /assistant/suggestions': { status: 200, body: { items: [] } },
    'GET /assistant/threads': { status: 200, body: { data: [threadFixture()] } },
    ...routes,
  });
}

/** The app layout in small: the assistant page, any other page, and the bubble after them. */
function renderApp(path: string) {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <AssistantBubble />
      </>
    ),
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: '/app/assistant',
    component: AssistantPage,
  });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: () => <p>page</p> });
  const router = createRouter({
    routeTree: root.addChildren([page, any]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  renderWithProviders(<RouterProvider router={router} />);
  return router;
}

beforeAll(async () => {
  await Promise.all([import('./assistant-panel'), loadNamespace('assistant')]);
});

beforeEach(() => {
  useAssistantUi.setState({
    open: false,
    workspaceId: null,
    threadId: null,
    spotlight: null,
    draft: null,
    entityExtras: null,
    pageSlot: null,
    sheetAfterPage: false,
    lastPage: null,
  });
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(ASSISTANT_IDS.turn);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AssistantPage', () => {
  it('expands the sheet to the full page and collapses back, keeping the conversation', async () => {
    const { fetchStub } = stubFetch({
      [THREAD_MESSAGES]: {
        status: 200,
        body: { data: [messageFixture({ content: 'Doanh thu tháng này là 12 triệu.' })] },
      },
      [THREAD_PROPOSALS]: { status: 200, body: { items: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const router = renderApp('/app/orders?status=new');
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: ASSISTANT_IDS.thread });
    const user = userEvent.setup();

    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('Doanh thu tháng này là 12 triệu.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Mở rộng toàn màn hình' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/assistant'));
    const page = await screen.findByTestId('assistant-page');
    expect(await within(page).findByText('Doanh thu tháng này là 12 triệu.')).toBeInTheDocument();
    expect(within(page).getByRole('tab', { name: 'Trò chuyện' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The page replaces the sheet and the launcher.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hỏi Rapiz Agent' })).toBeNull();

    await user.click(within(page).getByRole('button', { name: 'Thu gọn về bảng bên phải' }));
    await waitFor(() => expect(router.state.location.href).toBe('/app/orders?status=new'));
    const back = await screen.findByRole('dialog');
    expect(within(back).getByText('Doanh thu tháng này là 12 triệu.')).toBeInTheDocument();
    expect(useAssistantUi.getState().threadId).toBe(ASSISTANT_IDS.thread);
  });

  it('follows an answer that opens another page into the side sheet', async () => {
    const { fetchStub } = stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [`POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: turnFixture('mở trang sản phẩm', {
          content: 'Đây là trang sản phẩm.',
          uiActions: [{ type: 'navigate', to: '/app/products' }],
        }),
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      [THREAD_MESSAGES]: { status: 200, body: { data: [] } },
      [THREAD_PROPOSALS]: { status: 200, body: { items: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const router = renderApp('/app/assistant');
    const user = userEvent.setup();

    const page = await screen.findByTestId('assistant-page');
    const box = await within(page).findByRole('textbox', { name: 'Hỏi Rapiz Agent…' });
    await user.type(box, 'mở trang sản phẩm{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/products'));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('Đây là trang sản phẩm.')).toBeInTheDocument();
  });

  it('switches the view with the tabs', async () => {
    const { fetchStub } = stubFetch({
      'GET /assistant/schedules': { status: 200, body: { items: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderApp('/app/assistant');
    const user = userEvent.setup();

    const page = await screen.findByTestId('assistant-page');
    await user.click(await within(page).findByRole('tab', { name: 'Lịch báo cáo' }));
    expect(within(page).getByRole('tab', { name: 'Lịch báo cáo' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(page).queryByRole('textbox', { name: 'Hỏi Rapiz Agent…' })).toBeNull();
  });

  it('keeps the sheet shut when the answer points at a control on the page it opened', async () => {
    const { fetchStub } = stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [`POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: turnFixture('tạo đơn ở đâu', {
          content: 'Bấm nút này.',
          uiActions: [
            { type: 'navigate', to: '/app/orders' },
            { type: 'spotlight', target: 'orders.new', hint: 'Ở đây' },
          ],
        }),
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      [THREAD_MESSAGES]: { status: 200, body: { data: [] } },
      [THREAD_PROPOSALS]: { status: 200, body: { items: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const router = renderApp('/app/assistant');
    const user = userEvent.setup();

    const page = await screen.findByTestId('assistant-page');
    await user.type(
      await within(page).findByRole('textbox', { name: 'Hỏi Rapiz Agent…' }),
      'tạo đơn ở đâu{Enter}',
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/orders'));
    await waitFor(() =>
      expect(useAssistantUi.getState().spotlight).toMatchObject({ target: 'orders.new' }),
    );
    expect(useAssistantUi.getState().open).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps what the owner was typing when the sheet expands', async () => {
    const { fetchStub } = stubFetch({});
    vi.stubGlobal('fetch', fetchStub);
    const router = renderApp('/app/orders');
    useAssistantUi.setState({ open: true, workspaceId: WS });
    const user = userEvent.setup();

    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByRole('textbox', { name: 'Hỏi Rapiz Agent…' }), 'doanh thu');
    await user.click(within(sheet).getByRole('button', { name: 'Mở rộng toàn màn hình' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/assistant'));
    const page = await screen.findByTestId('assistant-page');
    expect(await within(page).findByRole('textbox', { name: 'Hỏi Rapiz Agent…' })).toHaveValue(
      'doanh thu',
    );
  });
});
