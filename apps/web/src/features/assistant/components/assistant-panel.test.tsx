import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAssistantForm } from '@/lib/assistant-context';
import { loadNamespace } from '@/lib/i18n';
import type { Session } from '@/lib/session';
import {
  ASSISTANT_IDS,
  messageFixture,
  proposalFixture,
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
    renderApp();
    const user = userEvent.setup();

    expect(await screen.findByText('Đổi giá Áo thun thành 150.000đ')).toBeInTheDocument();
    expect(screen.getByText('Cho Shop An')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xem chi tiết' }));
    expect(screen.getByText(/"to": 150000/)).toBeInTheDocument();

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
});
