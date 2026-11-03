import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantAskButton } from '@/components/assistant-ask-button';
import {
  useAssistantContext,
  useAssistantForm,
  useAssistantRequest,
} from '@/lib/assistant-context';
import { openAssistantWith } from '@/lib/assistant-launch';
import { loadNamespace } from '@/lib/i18n';
import type { Session } from '@/lib/session';
import {
  ASSISTANT_IDS,
  learnedSkillFixture,
  messageFixture,
  proposalFixture,
  runFixture,
  skillFixture,
  suggestionFixture,
  threadFixture,
  turnFixture,
} from '@/testing/assistant-factories';
import { renderWithProviders, stubFetch as baseStubFetch } from '@/testing/render';

import { useAssistantUi } from '../stores/assistant-ui.store';
import { AssistantBubble } from './assistant-bubble';

const ACCOUNT = '0b9c3a52-5e3f-4c55-9a51-6a0f4b7d2c01';
const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const OTHER_WS = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const current = vi.hoisted(() => ({ ws: '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f' }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => current.ws }));
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

/** The chat view also asks for learning notices and suggestions: none, unless a test says so. */
function stubFetch(routes: Parameters<typeof baseStubFetch>[0]) {
  // Mutates `routes` so tests that change a route later still reach the stub.
  return baseStubFetch(
    Object.assign(routes, {
      'GET /assistant/learning': { status: 200, body: { items: [] } },
      'GET /assistant/suggestions': { status: 200, body: { items: [] } },
      ...routes,
    }),
  );
}

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

// The bubble lazy-loads the panel and its namespace. Load both once up front so the first test
// does not race a cold dynamic import against `findBy*`'s 1 s window on a busy machine.
beforeAll(async () => {
  await Promise.all([import('./assistant-panel'), loadNamespace('assistant')]);
});

beforeEach(() => {
  current.ws = WS;
  useAssistantUi.setState({
    open: false,
    workspaceId: null,
    threadId: null,
    spotlight: null,
    draft: null,
    entityExtras: null,
  });
  useAssistantRequest.setState({ request: null });
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
    expect(calls.filter((c) => c.key.includes('/threads'))).toHaveLength(0);
  });

  it('keeps the panel fixed on screen, not in the page flow', async () => {
    useAssistantUi.setState({ open: true });
    const { fetchStub } = stubFetch({});
    vi.stubGlobal('fetch', fetchStub);
    renderApp();

    const panel = await screen.findByRole('dialog');
    expect(panel).toHaveClass('fixed');
    // A position class merged after it (relative, static, absolute…) would cancel `fixed`.
    for (const other of ['relative', 'static', 'absolute', 'sticky']) {
      expect(panel).not.toHaveClass(other);
    }
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

  /** A fetch stub whose `held` request waits until `release()` is called. */
  function holdRequest(routes: Parameters<typeof stubFetch>[0], held: string) {
    const { fetchStub, calls } = stubFetch(routes);
    let release: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = async (input: string, init: RequestInit = {}) => {
      if (`${init.method ?? 'GET'} ${input.replace('/api/v1', '')}` === held) {
        reached();
        await gate;
      }
      return fetchStub(input, init);
    };
    return { fetch, calls, waiting, release: () => release() };
  }

  /** The owner switches business (the bubble resets the assistant to the new one). */
  function switchBusiness(): void {
    act(() => {
      current.ws = OTHER_WS;
      useAssistantUi.getState().syncWorkspace(OTHER_WS);
    });
  }

  it('drops the answer when the business changed while the turn ran', async () => {
    const send = `POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`;
    const held = holdRequest(
      {
        'POST /assistant/threads': { status: 201, body: threadFixture() },
        [send]: {
          status: 200,
          body: turnFixture('mở trang sản phẩm', {
            content: 'Đây là trang sản phẩm.',
            uiActions: [
              { type: 'navigate', to: '/app/products' },
              { type: 'spotlight', target: 'orders.new', hint: 'Ở đây' },
            ],
          }),
        },
        [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
        'GET /assistant/threads': { status: 200, body: { data: [] } },
      },
      send,
    );
    vi.stubGlobal('fetch', held.fetch);
    const router = renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' }),
      'mở trang sản phẩm{Enter}',
    );
    await held.waiting;
    switchBusiness();
    held.release();

    await waitFor(() => expect(held.calls.some((c) => c.key === send)).toBe(true));
    // Give the answer time to arrive, then check nothing was applied to the new business.
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe('/app/orders');
    expect(useAssistantUi.getState()).toMatchObject({
      workspaceId: OTHER_WS,
      threadId: null,
      spotlight: null,
    });
  });

  it('does not keep a thread created for the business the owner just left', async () => {
    const held = holdRequest(
      {
        'POST /assistant/threads': { status: 201, body: threadFixture() },
        'GET /assistant/threads': { status: 200, body: { data: [] } },
      },
      'POST /assistant/threads',
    );
    vi.stubGlobal('fetch', held.fetch);
    renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    await user.type(await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' }), 'chào{Enter}');
    await held.waiting;
    switchBusiness();
    held.release();

    await new Promise((r) => setTimeout(r, 50));
    expect(useAssistantUi.getState()).toMatchObject({ workspaceId: OTHER_WS, threadId: null });
    expect(held.calls.some((c) => c.key.endsWith('/messages'))).toBe(false);
  });

  /** A product page in small: two fields registered as form `product`, and its save button. */
  function ProductFormPage() {
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    useAssistantForm(
      'product',
      () => [
        { name: 'name', label: 'Tên', type: 'text', empty: !name },
        { name: 'price', label: 'Giá', type: 'number', empty: !price },
      ],
      (values) => {
        if (values['name'] !== undefined) setName(String(values['name']));
        if (values['price'] !== undefined) setPrice(String(values['price']));
      },
      { submitTarget: 'products.save' },
    );
    return (
      <form>
        <input aria-label="Tên" value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="Giá" value={price} onChange={(e) => setPrice(e.target.value)} />
        <button type="submit" data-assistant-target="products.save">
          Lưu
        </button>
      </form>
    );
  }

  function fillTurn(formId: string) {
    return stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [`POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: turnFixture('điền giúp', {
          content: 'Mình điền rồi nhé.',
          uiActions: [
            { type: 'fill_form', formId, values: { name: 'Áo thun', price: 150000, color: 'đỏ' } },
          ],
        }),
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
        status: 200,
        body: { items: [] },
      },
      'GET /assistant/threads': { status: 200, body: { data: [] } },
    });
  }

  it('sends the form with the page context, fills it from the answer and points at Save', async () => {
    const { fetchStub, calls } = fillTurn('product');
    vi.stubGlobal('fetch', fetchStub);
    renderApp(ProductFormPage, '/app/products/new');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' }),
      'điền giúp{Enter}',
    );

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Tên' })).toHaveValue('Áo thun'),
    );
    expect(screen.getByRole('textbox', { name: 'Giá' })).toHaveValue('150000');
    expect(useAssistantUi.getState().spotlight).toEqual({
      target: 'products.save',
      hint: 'Mình đã điền sẵn. Anh/chị kiểm tra lại rồi bấm Lưu nhé.',
    });
    expect(calls.find((c) => c.key.endsWith('/messages'))?.body).toMatchObject({
      pageContext: {
        route: '/app/products/new',
        targets: ['products.save'],
        forms: [
          {
            id: 'product',
            fields: [
              { name: 'name', label: 'Tên', type: 'text', empty: true },
              { name: 'price', label: 'Giá', type: 'number', empty: true },
            ],
          },
        ],
      },
    });
    // Filled, never submitted.
    expect(calls.some((c) => c.key.startsWith('POST /products'))).toBe(false);
  });

  it('says so when the form to fill is not on the page', async () => {
    const { fetchStub } = fillTurn('order');
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' }),
      'điền giúp{Enter}',
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Biểu mẫu Thỏ Rapiz định điền không có trên trang này. Mở đúng trang rồi hỏi lại nhé.',
      ),
    );
    expect(useAssistantUi.getState().spotlight).toBeNull();
  });

  it('does not run a chart action: no navigate, no fill, no spotlight', async () => {
    const { fetchStub } = stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [`POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: turnFixture('doanh thu tuần này', {
          content: 'Doanh thu tuần này là 1.250.000đ.',
          uiActions: [
            {
              type: 'chart',
              chart: {
                kind: 'bar',
                title: 'Doanh thu theo ngày',
                x: { key: 'product', label: 'Ngày' },
                series: [{ key: 'name', label: 'Doanh thu' }],
                unit: 'vnd',
                rows: [{ product: '2026-11-02', name: 1_250_000 }],
              },
            },
          ],
        }),
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
        status: 200,
        body: { items: [] },
      },
      'GET /assistant/threads': { status: 200, body: { data: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    // A form is on screen, named like the chart's keys: a chart must never be read as a fill.
    const router = renderApp(ProductFormPage, '/app/products/new');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' }),
      'doanh thu tuần này{Enter}',
    );

    expect(await screen.findByText('Doanh thu tuần này là 1.250.000đ.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe('/app/products/new');
    expect(screen.getByRole('textbox', { name: 'Tên' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Giá' })).toHaveValue('');
    expect(toast).not.toHaveBeenCalled();
    expect(useAssistantUi.getState().spotlight).toBeNull();
  });

  it('applies a proposal: buttons wait for the answer, then the status and event show', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: ASSISTANT_IDS.thread });
    const listMessages = `GET /assistant/threads/${ASSISTANT_IDS.thread}/messages`;
    const listProposals = `GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`;
    const approve = `POST /assistant/proposals/${ASSISTANT_IDS.proposal}/approve`;
    const conversation = turnFixture('tăng giá áo thun', {
      content: 'Mình đã chuẩn bị đề xuất, anh/chị bấm Áp dụng nhé.',
    }).messages;
    const routes: Parameters<typeof stubFetch>[0] = {
      [listMessages]: { status: 200, body: { data: conversation } },
      [listProposals]: { status: 200, body: { items: [proposalFixture()] } },
      [approve]: {
        status: 200,
        body: proposalFixture({ status: 'done', decidedAt: '2026-11-02T08:01:00.000Z' }),
      },
      'GET /assistant/threads': { status: 200, body: { data: [threadFixture()] } },
    };
    const held = holdRequest(routes, approve);
    vi.stubGlobal('fetch', held.fetch);
    // The page behind the panel: a business-scoped query that must refetch after the approval.
    const productsFetch = vi.fn(() => Promise.resolve(['Áo thun']));
    function ProductsPage() {
      useQuery({ queryKey: ['ws', WS, 'products', 'list'], queryFn: productsFetch });
      return <p>products</p>;
    }
    renderApp(ProductsPage, '/app/products');
    const user = userEvent.setup();

    expect(await screen.findByText('Đổi giá Áo thun thành 150.000đ')).toBeInTheDocument();
    expect(screen.getByText('Cho Shop An')).toBeInTheDocument();
    // What will run comes from the route, not the summary; a PATCH shows its preview at once.
    expect(screen.getByTestId('proposal-action')).toHaveTextContent('Sửa/products/{productId}');
    expect(screen.getByRole('button', { name: 'Ẩn chi tiết' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(/"to": 150000/)).toBeInTheDocument();
    expect(productsFetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await held.waiting;
    expect(screen.getByRole('button', { name: 'Đang áp dụng…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bỏ' })).toBeDisabled();

    // The owner looks at the thread list and comes back: the card is new, still busy.
    await user.click(screen.getByRole('button', { name: 'Xem các cuộc trò chuyện' }));
    expect(screen.queryByRole('button', { name: 'Bỏ' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quay lại cuộc trò chuyện' }));
    expect(await screen.findByRole('button', { name: 'Đang áp dụng…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bỏ' })).toBeDisabled();

    // After the decision the thread has an event message, and the proposal is done.
    routes[listMessages] = {
      status: 200,
      body: {
        data: [
          ...conversation,
          messageFixture({
            id: ASSISTANT_IDS.event,
            seq: 3,
            role: 'event',
            content: 'Đã áp dụng: Đổi giá Áo thun thành 150.000đ',
            runId: null,
            createdAt: '2026-11-02T08:01:00.000Z',
          }),
        ],
      },
    };
    routes[listProposals] = {
      status: 200,
      body: { items: [proposalFixture({ status: 'done', decidedAt: '2026-11-02T08:01:00.000Z' })] },
    };
    held.release();

    expect(
      await screen.findByText('Đã áp dụng: Đổi giá Áo thun thành 150.000đ'),
    ).toBeInTheDocument();
    expect(screen.getByText('Đã áp dụng')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Áp dụng' })).not.toBeInTheDocument();
    expect(held.calls.filter((c) => c.key === listMessages)).toHaveLength(2);
    await waitFor(() => expect(productsFetch).toHaveBeenCalledTimes(2));
  });

  it('marks a delete as destructive and shows the record next to the change', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: ASSISTANT_IDS.thread });
    const proposal = proposalFixture({
      routeKey: 'DELETE /warehouses/{warehouseId}',
      summary: 'Cập nhật ghi chú',
      preview: { body: null, query: null, before: { name: 'Kho Quận 1' } },
    });
    const { fetchStub } = stubFetch({
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: { data: turnFixture('ghi chú').messages },
      },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
        status: 200,
        body: { items: [proposal] },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderApp();

    // The innocent summary cannot hide that this deletes a warehouse.
    expect(await screen.findByText('Cập nhật ghi chú')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-action')).toHaveTextContent('Xoá/warehouses/{warehouseId}');
    expect(screen.getByRole('listitem', { name: 'Đề xuất thay đổi' })).toHaveAttribute(
      'data-destructive',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
    expect(screen.getByText('Hiện tại')).toBeInTheDocument();
    expect(screen.getByText(/"name": "Kho Quận 1"/)).toBeInTheDocument();
  });

  it('keeps the preview of a create closed and the apply button plain', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: ASSISTANT_IDS.thread });
    const { fetchStub } = stubFetch({
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: { data: turnFixture('thêm').messages },
      },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
        status: 200,
        body: {
          items: [
            proposalFixture({
              routeKey: 'POST /products',
              summary: 'Thêm Áo len',
              preview: { body: { name: 'Áo len' }, query: null },
            }),
          ],
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderApp();

    expect(await screen.findByText('Thêm Áo len')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-action')).toHaveTextContent('Tạo/products');
    expect(screen.getByRole('button', { name: 'Xem chi tiết' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toHaveAttribute(
      'data-variant',
      'default',
    );
  });

  it('shows why a proposal can no longer be applied (409 expired)', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: ASSISTANT_IDS.thread });
    const listProposals = `GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`;
    const routes: Parameters<typeof stubFetch>[0] = {
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: { data: turnFixture('đổi giá').messages },
      },
      [listProposals]: { status: 200, body: { items: [proposalFixture()] } },
      [`POST /assistant/proposals/${ASSISTANT_IDS.proposal}/approve`]: {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'This proposal has expired',
            traceId: 't',
            details: { reason: 'proposal_expired' },
          },
        },
      },
    };
    const { fetchStub } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();

    const apply = await screen.findByRole('button', { name: 'Áp dụng' });
    // Meanwhile the proposal expired on the server.
    routes[listProposals] = {
      status: 200,
      body: { items: [proposalFixture({ status: 'expired' })] },
    };
    await user.click(apply);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Đề xuất này đã hết hạn. Hỏi lại Thỏ Rapiz nếu vẫn cần.',
      ),
    );
    expect(await screen.findByText('Đã hết hạn')).toBeInTheDocument();
  });

  it('shows what the assistant just learned, with undo and a way to the pending skill', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: null });
    const undo = `POST /assistant/skill-events/${ASSISTANT_IDS.skillEvent}/undo`;
    const forget = `POST /assistant/memory/owner_profile/entries/e9/undo`;
    const memoryItem = {
      kind: 'memory' as const,
      actor: 'review' as const,
      store: 'owner_profile',
      entryId: 'e9',
      text: 'Thích báo giá theo thùng.',
      previousText: 'Thích báo giá theo cái.',
      at: '2026-11-02T07:00:00.000Z',
    };
    const routes: Parameters<typeof stubFetch>[0] = {
      'GET /assistant/learning': {
        status: 200,
        body: { items: [learnedSkillFixture(), memoryItem] },
      },
      [undo]: { status: 200, body: skillFixture({ state: 'archived' }) },
      [forget]: { status: 200, body: { stores: [] } },
      'GET /assistant/skills': { status: 200, body: { items: [skillFixture()] } },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();

    const notices = await screen.findByRole('region', { name: 'Trợ lý vừa học' });
    expect(
      within(notices).getByText('💡 Trợ lý vừa học kỹ năng mới: bao-gia-si'),
    ).toBeInTheDocument();
    expect(
      within(notices).getByText(
        '💡 Trợ lý vừa sửa: "Thích báo giá theo cái." → "Thích báo giá theo thùng."',
      ),
    ).toBeInTheDocument();

    // Undo the skill: it is archived, and the feed now flags it undone.
    routes['GET /assistant/learning'] = {
      status: 200,
      body: { items: [learnedSkillFixture({ undone: true, state: 'archived' }), memoryItem] },
    };
    const skillLine = within(notices)
      .getByText('💡 Trợ lý vừa học kỹ năng mới: bao-gia-si')
      .closest('li') as HTMLElement;
    await user.click(within(skillLine).getByRole('button', { name: 'Hoàn tác' }));
    await waitFor(() =>
      expect(
        screen.queryByText('💡 Trợ lý vừa học kỹ năng mới: bao-gia-si'),
      ).not.toBeInTheDocument(),
    );
    expect(calls.filter((c) => c.key === undo)).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith('Đã hoàn tác.');

    // Undo the rewritten memory entry: the server gives the old text back.
    routes['GET /assistant/learning'] = { status: 200, body: { items: [] } };
    await user.click(within(notices).getByRole('button', { name: 'Hoàn tác' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Trợ lý vừa học' })).not.toBeInTheDocument(),
    );
    expect(calls.filter((c) => c.key === forget)).toHaveLength(1);
  });

  it('opens the skills view from a pending skill notice', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: null });
    const { fetchStub } = stubFetch({
      'GET /assistant/learning': { status: 200, body: { items: [learnedSkillFixture()] } },
      'GET /assistant/skills': { status: 200, body: { items: [skillFixture()] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Xem' }));
    expect(await screen.findByRole('region', { name: 'Đang chờ duyệt' })).toBeInTheDocument();
  });

  it('shows the skill a suggestion would draft, body on demand, and accepts it as a draft', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: null });
    const card = suggestionFixture({
      kind: 'skill',
      title: 'Lưu cách báo giá sỉ thành kỹ năng',
      payload: {
        name: 'bao-gia-si',
        description: 'Báo giá cho khách sỉ',
        body: '1. Giảm 10% khi mua từ 10 sản phẩm.',
      },
    });
    const accept = `POST /assistant/suggestions/${ASSISTANT_IDS.suggestion}/accept`;
    const routes: Parameters<typeof stubFetch>[0] = {
      'GET /assistant/suggestions': { status: 200, body: { items: [card] } },
      [accept]: {
        status: 200,
        body: {
          suggestion: { ...card, status: 'accepted' },
          skill: skillFixture(),
          path: null,
        },
      },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();

    const cards = await screen.findByRole('region', { name: 'Gợi ý của trợ lý' });
    expect(within(cards).getByText('bao-gia-si')).toBeInTheDocument();
    expect(
      within(cards).queryByText('1. Giảm 10% khi mua từ 10 sản phẩm.'),
    ).not.toBeInTheDocument();
    await user.click(within(cards).getByRole('button', { name: 'Xem nội dung' }));
    expect(within(cards).getByText('1. Giảm 10% khi mua từ 10 sản phẩm.')).toBeInTheDocument();

    routes['GET /assistant/suggestions'] = { status: 200, body: { items: [] } };
    await user.click(within(cards).getByRole('button', { name: 'Đồng ý' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Đã lưu bản nháp kỹ năng bao-gia-si. Duyệt nó trong mục Kỹ năng.',
      ),
    );
    expect(calls.filter((c) => c.key === accept)).toHaveLength(1);
  });

  it('accepts a setup suggestion and opens its page; dismisses another', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: null });
    const other = suggestionFixture({
      id: '0193b000-0000-7000-8000-000000000602',
      kind: 'schedule',
      title: 'Gửi báo cáo doanh thu mỗi sáng',
      payload: {},
    });
    const accept = `POST /assistant/suggestions/${ASSISTANT_IDS.suggestion}/accept`;
    const dismiss = `POST /assistant/suggestions/${other.id}/dismiss`;
    const routes: Parameters<typeof stubFetch>[0] = {
      'GET /assistant/suggestions': {
        status: 200,
        body: { items: [suggestionFixture(), other] },
      },
      [accept]: {
        status: 200,
        body: {
          suggestion: suggestionFixture({ status: 'accepted' }),
          skill: null,
          path: '/app/settings/notifications',
        },
      },
      [dismiss]: { status: 200, body: { ...other, status: 'dismissed' } },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    const router = renderApp();
    const user = userEvent.setup();

    const cards = await screen.findByRole('region', { name: 'Gợi ý của trợ lý' });
    const setupCard = within(cards).getByText('Bật thông báo đơn mới').closest('li') as HTMLElement;
    routes['GET /assistant/suggestions'] = { status: 200, body: { items: [other] } };
    await user.click(within(setupCard).getByRole('button', { name: 'Đồng ý' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/settings/notifications'));
    expect(calls.filter((c) => c.key === accept)).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByText('Bật thông báo đơn mới')).not.toBeInTheDocument(),
    );

    routes['GET /assistant/suggestions'] = { status: 200, body: { items: [] } };
    await user.click(screen.getByRole('button', { name: 'Bỏ qua' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Gợi ý của trợ lý' })).not.toBeInTheDocument(),
    );
    expect(calls.filter((c) => c.key === dismiss)).toHaveLength(1);
  });

  it('never leaves the dashboard for an accepted suggestion path', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: null });
    const accept = `POST /assistant/suggestions/${ASSISTANT_IDS.suggestion}/accept`;
    const routes: Parameters<typeof stubFetch>[0] = {
      'GET /assistant/suggestions': { status: 200, body: { items: [suggestionFixture()] } },
      [accept]: {
        status: 200,
        body: {
          suggestion: suggestionFixture({ status: 'accepted' }),
          skill: null,
          path: '/app/%2e%2e/login',
        },
      },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    const router = renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Đồng ý' }));
    await waitFor(() => expect(calls.some((c) => c.key === accept)).toBe(true));
    // The list refetches after the decision, so its handling (and any navigation) is over.
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'GET /assistant/suggestions')).toHaveLength(2),
    );
    expect(router.state.location.pathname).toBe('/app/orders');
  });

  it('toggles 👍/👎 under an answer', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: ASSISTANT_IDS.thread });
    const feedback = `POST /assistant/messages/${ASSISTANT_IDS.answer}/feedback`;
    const { fetchStub, calls } = stubFetch({
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: { data: turnFixture('chào').messages },
      },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
        status: 200,
        body: { items: [] },
      },
      [feedback]: { status: 204 },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();

    const up = await screen.findByRole('button', { name: 'Câu trả lời hữu ích' });
    const down = screen.getByRole('button', { name: 'Câu trả lời chưa tốt' });
    expect(up).toHaveAttribute('aria-pressed', 'false');

    await user.click(up);
    await waitFor(() => expect(up).toHaveAttribute('aria-pressed', 'true'));
    await user.click(down);
    await waitFor(() => expect(down).toHaveAttribute('aria-pressed', 'true'));
    expect(up).toHaveAttribute('aria-pressed', 'false');
    // Pressing the chosen one again clears it.
    await user.click(down);
    await waitFor(() => expect(down).toHaveAttribute('aria-pressed', 'false'));

    await waitFor(() =>
      expect(calls.filter((c) => c.key === feedback).map((c) => c.body)).toEqual([
        { value: 1 },
        { value: -1 },
        { value: 0 },
      ]),
    );
  });

  /** An empty list page with the ask button and a dialog form registered by the list. */
  function EmptyFaqPage() {
    const [prefill, setPrefill] = useState<string | null>(null);
    useAssistantForm(
      'faq',
      () => [{ name: 'question', label: 'Câu hỏi', type: 'textarea', empty: true }],
      (values) => setPrefill(String(values['question'] ?? '')),
      { opensDialog: true },
    );
    return (
      <>
        <AssistantAskButton text="Điền mẫu FAQ giúp mình" />
        {prefill === null ? null : <p>dialog:{prefill}</p>}
      </>
    );
  }

  it('opens and sends what a page asked for when no turn runs', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [`POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: turnFixture('Điền mẫu FAQ giúp mình', { content: 'Mình soạn rồi.' }),
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
        status: 200,
        body: { items: [] },
      },
      'GET /assistant/threads': { status: 200, body: { data: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderApp(EmptyFaqPage, '/app/bots/b1/knowledge');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Nhờ trợ lý điền mẫu' }));

    expect(await screen.findByText('Mình soạn rồi.')).toBeInTheDocument();
    expect(useAssistantUi.getState().open).toBe(true);
    expect(calls.find((c) => c.key.endsWith('/messages'))?.body).toMatchObject({
      text: 'Điền mẫu FAQ giúp mình',
      pageContext: { route: '/app/bots/b1/knowledge' },
    });
    expect(useAssistantRequest.getState().request).toBeNull();
  });

  it('opens the panel again when a page asks after it was loaded and closed', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [`POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: turnFixture('Điền mẫu FAQ giúp mình', { content: 'Mình soạn rồi.' }),
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
        status: 200,
        body: { items: [] },
      },
      'GET /assistant/threads': { status: 200, body: { data: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderApp(EmptyFaqPage, '/app/bots/b1/knowledge');
    const user = userEvent.setup();

    // Load the panel, then close it: it stays mounted and takes the next request itself.
    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' });
    act(() => useAssistantUi.getState().setOpen(false));
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Nhờ trợ lý điền mẫu' }));

    expect(await screen.findByText('Mình soạn rồi.')).toBeInTheDocument();
    expect(useAssistantUi.getState().open).toBe(true);
    expect(calls.filter((c) => c.key.endsWith('/messages'))).toHaveLength(1);
    expect(calls.find((c) => c.key.endsWith('/messages'))?.body).toMatchObject({
      text: 'Điền mẫu FAQ giúp mình',
    });
  });

  it('leaves a request in the composer while a turn runs', async () => {
    const send = `POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`;
    const held = holdRequest(
      {
        'POST /assistant/threads': { status: 201, body: threadFixture() },
        [send]: { status: 200, body: turnFixture('xin chào', { content: 'Chào anh.' }) },
        [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
        [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
          status: 200,
          body: { items: [] },
        },
        'GET /assistant/threads': { status: 200, body: { data: [] } },
      },
      send,
    );
    vi.stubGlobal('fetch', held.fetch);
    renderApp(EmptyFaqPage, '/app/bots/b1/knowledge');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    const box = await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' });
    await user.type(box, 'xin chào{Enter}');
    await held.waiting;
    await user.click(screen.getByRole('button', { name: 'Nhờ trợ lý điền mẫu' }));
    await waitFor(() => expect(box).toHaveValue('Điền mẫu FAQ giúp mình'));
    held.release();

    expect(await screen.findByText('Chào anh.')).toBeInTheDocument();
    // Only the owner's own message was sent; the request waits for them.
    expect(held.calls.filter((c) => c.key === send)).toHaveLength(1);
    expect(box).toHaveValue('Điền mẫu FAQ giúp mình');
  });

  it('steps aside without a spotlight after a fill that opens a dialog', async () => {
    const { fetchStub } = fillTurn('faq');
    vi.stubGlobal('fetch', fetchStub);
    renderApp(EmptyFaqPage, '/app/bots/b1/knowledge');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' }),
      'điền giúp{Enter}',
    );

    // `faq` has no `question` in the fixture values: the dialog opens with an empty prefill.
    expect(await screen.findByText('dialog:')).toBeInTheDocument();
    await waitFor(() => expect(useAssistantUi.getState().open).toBe(false));
    expect(useAssistantUi.getState().spotlight).toBeNull();
  });

  it('opens from a page with a prefilled question and sends its messageAt once (T-174)', async () => {
    const send = `POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`;
    const { fetchStub, calls } = stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [send]: { status: 200, body: turnFixture('Vì sao', { content: 'Dạ do thiếu FAQ ạ.' }) },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      'GET /assistant/threads': { status: 200, body: { data: [threadFixture()] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const MESSAGE_AT = '2026-11-02T08:04:00.000Z';
    function Inbox() {
      useAssistantContext({ entity: { conversationId: 'c1', botId: 'b1' } });
      return (
        <button
          onClick={() =>
            openAssistantWith('Vì sao bot trả lời tin nhắn lúc 15:04 như vậy?', {
              messageAt: MESSAGE_AT,
            })
          }
        >
          Hỏi vì sao
        </button>
      );
    }
    renderApp(Inbox, '/app/inbox');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi vì sao' }));
    const box = await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' });
    await waitFor(() => expect(box).toHaveValue('Vì sao bot trả lời tin nhắn lúc 15:04 như vậy?'));
    await user.type(box, '{Enter}');
    expect(await screen.findByText('Dạ do thiếu FAQ ạ.')).toBeInTheDocument();
    const sent = calls.filter((c) => c.key === send);
    expect(sent[0]?.body).toMatchObject({
      text: 'Vì sao bot trả lời tin nhắn lúc 15:04 như vậy?',
      pageContext: {
        route: '/app/inbox',
        entity: { conversationId: 'c1', botId: 'b1', messageAt: MESSAGE_AT },
      },
    });
    // The time belongs to that question only.
    await user.type(box, 'còn gì nữa{Enter}');
    await waitFor(() => expect(calls.filter((c) => c.key === send)).toHaveLength(2));
    expect(calls.filter((c) => c.key === send)[1]?.body).toMatchObject({
      pageContext: { entity: { conversationId: 'c1', botId: 'b1' } },
    });
    expect(
      (calls.filter((c) => c.key === send)[1]?.body as { pageContext: { entity: object } })
        .pageContext.entity,
    ).not.toHaveProperty('messageAt');
  });

  it('says when keys were hidden from the message', async () => {
    const { fetchStub } = stubFetch({
      'POST /assistant/threads': { status: 201, body: threadFixture() },
      [`POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: { ...turnFixture('curl', { content: 'Dạ em đọc được rồi.' }), secretsRemoved: true },
      },
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: { status: 200, body: runFixture() },
      'GET /assistant/threads': { status: 200, body: { data: [threadFixture()] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' }));
    await user.type(await screen.findByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' }), 'curl{Enter}');
    expect(await screen.findByText('Dạ em đọc được rồi.')).toBeInTheDocument();
    expect(
      screen.getByText('Đã ẩn khoá bí mật trong tin nhắn. Hãy nhập khoá trực tiếp vào form API.'),
    ).toBeInTheDocument();
  });

  it('labels a drafted API action as off, and opens it to type the key once created', async () => {
    const BOT = '0193b000-0000-7000-8000-000000000501';
    const ACTION = '0193b000-0000-7000-8000-000000000601';
    const draft = proposalFixture({
      routeKey: 'POST /bots/{botId}/actions',
      path: `/bots/${BOT}/actions`,
      summary: 'Thêm API tra cứu đơn',
      preview: { body: { name: 'Tra cứu đơn', enabled: false }, query: null },
    });
    const show = async (proposal: typeof draft) => {
      useAssistantUi.setState({ open: true, workspaceId: WS, threadId: ASSISTANT_IDS.thread });
      vi.stubGlobal(
        'fetch',
        stubFetch({
          [`GET /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
            status: 200,
            body: { data: turnFixture('thêm api').messages },
          },
          [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
            status: 200,
            body: { items: [proposal] },
          },
        }).fetchStub,
      );
      return renderApp();
    };

    await show(draft);
    expect(await screen.findByText('Đang tắt — bật sau khi thử gọi')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mở để nhập khoá' })).not.toBeInTheDocument();
    cleanup();

    await show({ ...draft, status: 'done', resultId: ACTION, decidedAt: draft.createdAt });
    expect(await screen.findByRole('link', { name: 'Mở để nhập khoá' })).toHaveAttribute(
      'href',
      `/app/bots/${BOT}/actions/${ACTION}`,
    );
  });

  it('opens an accepted schedule suggestion in the schedule editor (T-172 wiring)', async () => {
    useAssistantUi.setState({ open: true, workspaceId: WS, threadId: null, scheduleDraft: null });
    const card = suggestionFixture({
      kind: 'schedule',
      title: 'Báo khi khách chờ lâu?',
      payload: {},
    });
    const draft = {
      businessId: '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
      name: 'Khách chờ lâu',
      template: 'unanswered_conversations',
      mode: 'alert',
      params: { minutes: 30, minCount: 1 },
      cadence: { kind: 'every', minutes: 60 },
      channels: ['in_app'],
      commentary: false,
    };
    const accept = `POST /assistant/suggestions/${ASSISTANT_IDS.suggestion}/accept`;
    const routes: Parameters<typeof stubFetch>[0] = {
      'GET /assistant/suggestions': { status: 200, body: { items: [card] } },
      [accept]: {
        status: 200,
        body: {
          suggestion: { ...card, status: 'accepted' },
          skill: null,
          path: null,
          scheduleDraft: draft,
        },
      },
      'GET /assistant/schedules': {
        status: 200,
        body: { items: [], limit: 10, used: 0, emailAvailable: true },
      },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderApp();
    const user = userEvent.setup();

    const cards = await screen.findByRole('region', { name: 'Gợi ý của trợ lý' });
    routes['GET /assistant/suggestions'] = { status: 200, body: { items: [] } };
    await user.click(within(cards).getByRole('button', { name: 'Đồng ý' }));

    const form = await screen.findByRole('form', { name: 'Lịch mới' });
    expect(within(form).getByRole('textbox', { name: 'Tên lịch' })).toHaveValue('Khách chờ lâu');
    expect(calls.filter((c) => c.key === accept)).toHaveLength(1);
    expect(useAssistantUi.getState().scheduleDraft).toBeNull();
  });
});
