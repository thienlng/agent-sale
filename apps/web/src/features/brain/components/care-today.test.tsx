import type {
  AiDoneResponse,
  ImpactResponse,
  TodayApprovalItem,
  TodayResponse,
} from '@agent-sales/contracts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast, Toaster } from 'sonner';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { TodayPage, visibleQueues } from './today-page';

const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const CONV = '0190f5c2-0000-7000-8000-00000000c001';
const CONV2 = '0190f5c2-0000-7000-8000-00000000c002';
const CARE = '0190f5c2-0000-7000-8000-00000000a001';
const CARE2 = '0190f5c2-0000-7000-8000-00000000a002';
const H = 3_600_000;

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => WS }));
const perms = vi.hoisted(() => ({ canEdit: true, analytics: true }));
vi.mock('@/lib/permissions', () => ({
  useCan: (capability: string) =>
    capability === 'contacts.edit'
      ? perms.canEdit
      : capability === 'analytics.view'
        ? perms.analytics
        : true,
}));

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function draft(over: Partial<TodayApprovalItem> = {}): TodayApprovalItem {
  return {
    conversationId: CONV,
    contactId: null,
    customerName: 'Chị Lan',
    avatarUrl: null,
    channel: 'facebook',
    reason: '',
    stage: 'price_asked',
    mood: 'neutral',
    at: iso(-2 * H),
    assigneeId: null,
    assigneeName: null,
    stageLocked: false,
    careMessageId: CARE,
    template: 'silent',
    text: 'Dạ chị Lan ơi, mẫu áo chị hỏi vẫn còn size M ạ.',
    windowClosesAt: iso(3 * H + 60_000),
    scheduledFor: null,
    createdAt: iso(-60_000),
    ...over,
  };
}

function today(drafts: TodayApprovalItem[]): TodayResponse {
  return {
    queues: [
      { key: 'attention', count: 0, items: [] },
      { key: 'unanswered', count: 0, items: [] },
      { key: 'ready', count: 0, items: [] },
      { key: 'price_silent', count: 0, items: [] },
      { key: 'follow_up', count: 0, items: [] },
      {
        key: 'approval',
        count: drafts.filter((d) => !d.scheduledFor).length,
        items: drafts,
      },
      { key: 'tasks', count: 0, items: [] },
    ],
    usage: { used: 3, limit: 200 },
    mode: 'auto',
    generatedAt: new Date().toISOString(),
  };
}

const twoDrafts = () => [
  draft(),
  draft({
    conversationId: CONV2,
    careMessageId: CARE2,
    customerName: 'Anh Minh',
    template: 'ready',
    text: 'Anh Minh ơi, anh chuyển khoản là shop giao trong ngày ạ.',
    windowClosesAt: iso(40 * 60_000 + 30_000),
  }),
];

const noAiDone: AiDoneResponse = { count: 0, items: [] };

function impact(over: Partial<ImpactResponse> = {}): ImpactResponse {
  return {
    range: '30d',
    since: iso(-30 * 24 * H),
    until: iso(0),
    followUpsSent: 40,
    repliesReceived: 12,
    ai: { orders: 8, revenue: 5_100_000 },
    aiStaff: { orders: 4, revenue: 3_300_000 },
    ...over,
  };
}

function sent(id: string) {
  return {
    id,
    conversationId: CONV,
    template: 'silent',
    step: 0,
    level: 'suggest',
    text: 'x',
    status: 'sent',
    skipReason: null,
    windowClosesAt: null,
    sentMessageId: null,
    sentAt: iso(0),
    decidedBy: null,
    decidedAt: iso(0),
    createdAt: iso(-60_000),
  };
}

function renderApp() {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <Toaster />
      </>
    ),
  });
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
}

/**
 * A fetch that holds the requests matching `held` until released: the row is gone (optimistic)
 * before the server answers, as on a real network.
 */
function holding(stub: ReturnType<typeof stubFetch>, held: (key: string) => boolean) {
  const waiting: Array<() => void> = [];
  const fetch = async (input: string, init: RequestInit = {}) => {
    if (held(`${init.method ?? 'GET'} ${input.replace('/api/v1', '')}`))
      await new Promise<void>((r) => waiting.push(r));
    return stub.fetchStub(input, init);
  };
  return { fetch, release: () => waiting.splice(0).forEach((r) => r()) };
}

function routes(
  body: TodayResponse,
  extra: Parameters<typeof stubFetch>[0] = {},
): Parameters<typeof stubFetch>[0] {
  return {
    'GET /today': { status: 200, body },
    'GET /today/ai-done': { status: 200, body: noAiDone },
    'GET /brain/impact?range=30d': { status: 200, body: impact() },
    ...extra,
  };
}

beforeAll(async () => {
  await loadNamespace('brain');
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
afterEach(() => {
  // Toasts live in sonner's module-level store: never let one test see another's.
  toast.dismiss();
  perms.canEdit = true;
  perms.analytics = true;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Today: "Chờ duyệt"', () => {
  it('lists the drafts first with the template, the text and the time left', async () => {
    vi.stubGlobal('fetch', stubFetch(routes(today(twoDrafts()))).fetchStub);
    renderApp();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    expect(within(queue).getByText('Chị Lan')).toBeInTheDocument();
    expect(within(queue).getByText('Khách im lặng')).toBeInTheDocument();
    expect(within(queue).getByText('Sắp chốt')).toBeInTheDocument();
    expect(within(queue).getByText(/mẫu áo chị hỏi vẫn còn size M/)).toBeInTheDocument();
    expect(within(queue).getByText('còn 3 giờ')).toBeInTheDocument();
    expect(within(queue).getByText('còn 40 phút')).toBeInTheDocument();
    // First among the queues and among the chips.
    expect(screen.getAllByRole('region')[1]).toBe(queue);
    const chips = within(screen.getByRole('navigation', { name: 'Tóm tắt các hàng' }));
    expect(chips.getAllByRole('link')[0]).toHaveTextContent('Chờ duyệt2');
  });

  it('sends a draft as it is, and drops another; the toasts come after the rows are gone', async () => {
    const stub = stubFetch(
      routes(today(twoDrafts()), {
        [`POST /today/approval/${CARE}/approve`]: { status: 200, body: sent(CARE) },
        [`POST /today/approval/${CARE2}/reject`]: {
          status: 200,
          body: { ...sent(CARE2), status: 'rejected' },
        },
      }),
    );
    const net = holding(stub, (k) => k.startsWith('POST'));
    vi.stubGlobal('fetch', net.fetch);
    renderApp();
    const user = userEvent.setup();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    await user.click(within(queue).getByRole('button', { name: 'Bỏ tin gửi Anh Minh' }));
    await waitFor(() => expect(within(queue).queryByText('Anh Minh')).toBeNull());
    net.release();
    expect(await screen.findByText('Đã bỏ tin này')).toBeInTheDocument();
    await user.click(within(queue).getByRole('button', { name: 'Gửi tin cho Chị Lan' }));
    await waitFor(() => expect(within(queue).queryByText('Chị Lan')).toBeNull());
    net.release();
    expect(await screen.findByText('Đã gửi tin cho Chị Lan')).toBeInTheDocument();
    expect(stub.calls.find((c) => c.key === `POST /today/approval/${CARE}/approve`)?.body).toEqual(
      {},
    );
  });

  it('warns when the channel did not take the message (200, failed)', async () => {
    const stub = stubFetch(
      routes(today([draft()]), {
        [`POST /today/approval/${CARE}/approve`]: {
          status: 200,
          body: { ...sent(CARE), status: 'failed' },
        },
      }),
    );
    const net = holding(stub, (k) => k.startsWith('POST'));
    vi.stubGlobal('fetch', net.fetch);
    renderApp();
    const user = userEvent.setup();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    await user.click(within(queue).getByRole('button', { name: 'Gửi tin cho Chị Lan' }));
    await waitFor(() => expect(within(queue).queryByText('Chị Lan')).toBeNull());
    net.release();
    expect(
      await screen.findByText('Tin chưa gửi được — kênh báo lỗi, thử lại sau'),
    ).toBeInTheDocument();
  });

  it('says when an approval at night goes out at 08:00, and lists it without actions', async () => {
    const stub = stubFetch(
      routes(
        today([
          draft(),
          draft({
            conversationId: CONV2,
            careMessageId: CARE2,
            customerName: 'Anh Minh',
            scheduledFor: '2026-11-12T01:00:00.000Z',
          }),
        ]),
        {
          [`POST /today/approval/${CARE}/approve`]: {
            status: 200,
            body: { ...sent(CARE), status: 'scheduled', scheduledFor: '2026-11-12T01:00:00.000Z' },
          },
        },
      ),
    );
    const net = holding(stub, (k) => k.startsWith('POST'));
    vi.stubGlobal('fetch', net.fetch);
    renderApp();
    const user = userEvent.setup();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    const minh = within(within(queue).getByText('Anh Minh').closest('li')!);
    expect(minh.getByText('Sẽ gửi lúc 08:00')).toBeInTheDocument();
    expect(minh.queryByRole('button')).toBeNull();
    // Only the draft waits for approval: no "Gửi tất cả" for a single draft.
    expect(within(queue).queryByRole('button', { name: 'Gửi tất cả' })).toBeNull();
    await user.click(within(queue).getByRole('button', { name: 'Gửi tin cho Chị Lan' }));
    await waitFor(() => expect(within(queue).queryByText('Chị Lan')).toBeNull());
    net.release();
    expect(
      await screen.findByText('Đã duyệt tin cho Chị Lan — sẽ gửi lúc 08:00'),
    ).toBeInTheDocument();
  });

  it('puts back only the draft whose request failed, not one still being sent', async () => {
    const stub = stubFetch(
      routes(today(twoDrafts()), {
        [`POST /today/approval/${CARE}/approve`]: {
          status: 409,
          body: {
            error: { code: 'CONFLICT', message: 'x', details: { reason: 'CARE_TAKEN_OVER' } },
          },
        },
        [`POST /today/approval/${CARE2}/approve`]: { status: 200, body: sent(CARE2) },
      }),
    );
    // Refetches of Today hang too, so only the cache's own rollback is on screen.
    let holdToday = false;
    const lan = holding(stub, (k) => k.startsWith('POST') || (holdToday && k === 'GET /today'));
    const minh = holding(stub, (k) => k.startsWith('POST'));
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) =>
      input.includes(CARE2) ? minh.fetch(input, init) : lan.fetch(input, init),
    );
    renderApp();
    const user = userEvent.setup();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    holdToday = true;
    await user.click(within(queue).getByRole('button', { name: 'Gửi tin cho Chị Lan' }));
    await user.click(within(queue).getByRole('button', { name: 'Gửi tin cho Anh Minh' }));
    await waitFor(() => expect(within(queue).queryByText('Anh Minh')).toBeNull());
    // Lan's request fails while Minh's is still on its way.
    lan.release();
    expect(
      await screen.findByText('Nhân viên đang giữ hội thoại này nên tin đã được bỏ'),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(queue).getByText('Chị Lan')).toBeInTheDocument());
    expect(within(queue).queryByText('Anh Minh')).toBeNull();
    holdToday = false;
    minh.release();
    lan.release();
  });

  it('edits a draft inline (at most 600 characters) and sends the edited text', async () => {
    const stub = stubFetch(
      routes(today([draft()]), {
        [`POST /today/approval/${CARE}/approve`]: { status: 200, body: sent(CARE) },
      }),
    );
    vi.stubGlobal('fetch', stub.fetchStub);
    renderApp();
    const user = userEvent.setup();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    await user.click(within(queue).getByRole('button', { name: 'Sửa rồi gửi tin cho Chị Lan' }));
    const editor = within(queue).getByRole('textbox', { name: 'Sửa tin gửi Chị Lan' });
    expect(editor).toHaveAttribute('maxLength', '600');
    await user.clear(editor);
    await user.type(editor, 'Chị Lan ơi, shop giữ size M cho chị đến tối nay ạ.');
    expect(within(queue).getByText('50/600 ký tự')).toBeInTheDocument();
    await user.click(within(queue).getByRole('button', { name: 'Gửi' }));
    await waitFor(() =>
      expect(
        stub.calls.find((c) => c.key === `POST /today/approval/${CARE}/approve`)?.body,
      ).toEqual({ text: 'Chị Lan ơi, shop giữ size M cho chị đến tối nay ạ.' }),
    );
  });

  it('sends all after a confirm and reports what was not sent', async () => {
    const stub = stubFetch(
      routes(today(twoDrafts()), {
        'POST /today/approval/approve-all': {
          status: 200,
          body: {
            sent: 1,
            scheduled: 0,
            notSent: 1,
            results: [
              { id: CARE, status: 'sent' },
              { id: CARE2, status: 'expired' },
            ],
          },
        },
      }),
    );
    vi.stubGlobal('fetch', stub.fetchStub);
    renderApp();
    const user = userEvent.setup();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    await user.click(within(queue).getByRole('button', { name: 'Gửi tất cả' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Gửi 2 tin chăm sóc?')).toBeInTheDocument();
    expect(stub.calls.some((c) => c.key === 'POST /today/approval/approve-all')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Gửi 2 tin' }));
    await waitFor(() =>
      expect(stub.calls.find((c) => c.key === 'POST /today/approval/approve-all')?.body).toEqual({
        ids: [CARE, CARE2],
      }),
    );
    expect(
      await screen.findByText('Đã gửi 1 tin · 1 tin đã hết hạn (hết 24 giờ hoặc khách vừa nhắn)'),
    ).toBeInTheDocument();
  });

  it('keeps "Gửi tất cả" off while a draft is being edited', async () => {
    vi.stubGlobal('fetch', stubFetch(routes(today(twoDrafts()))).fetchStub);
    renderApp();
    const user = userEvent.setup();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    expect(within(queue).getByRole('button', { name: 'Gửi tất cả' })).toBeEnabled();
    await user.click(within(queue).getByRole('button', { name: 'Sửa rồi gửi tin cho Chị Lan' }));
    expect(within(queue).getByRole('button', { name: 'Gửi tất cả' })).toBeDisabled();
    await user.click(within(queue).getByRole('button', { name: 'Hủy' }));
    expect(within(queue).getByRole('button', { name: 'Gửi tất cả' })).toBeEnabled();
  });

  it('says so when a draft was already handled (409) and puts it back', async () => {
    const stub = stubFetch(
      routes(today([draft()]), {
        [`POST /today/approval/${CARE}/approve`]: {
          status: 409,
          body: { error: { code: 'CONFLICT', message: 'decided' } },
        },
      }),
    );
    const net = holding(stub, (k) => k.startsWith('POST'));
    vi.stubGlobal('fetch', net.fetch);
    renderApp();
    const user = userEvent.setup();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    await user.click(within(queue).getByRole('button', { name: 'Gửi tin cho Chị Lan' }));
    await waitFor(() => expect(within(queue).queryByText('Chị Lan')).toBeNull());
    net.release();
    expect(
      await screen.findByText('Tin này không còn gửi được — đã có người xử lý hoặc đã hết 24 giờ'),
    ).toBeInTheDocument();
  });

  it('hides expired drafts, also when a draft expires while the page is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const drafts = [
      draft({ windowClosesAt: iso(-60_000) }),
      draft({
        conversationId: CONV2,
        careMessageId: CARE2,
        customerName: 'Anh Minh',
        windowClosesAt: iso(45_000),
      }),
    ];
    // Pure: the expired one is gone and the count follows.
    const approval = visibleQueues(today(drafts), Date.now())[0]!;
    expect(approval).toMatchObject({ key: 'approval', count: 1 });

    vi.stubGlobal('fetch', stubFetch(routes(today(drafts))).fetchStub);
    renderApp();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    expect(within(queue).queryByText('Chị Lan')).toBeNull();
    expect(within(queue).getByText('Anh Minh')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(within(queue).queryByText('Anh Minh')).toBeNull());
    expect(within(queue).getByText('Không có tin chăm sóc nào chờ duyệt.')).toBeInTheDocument();
  });

  it('shows read-only roles the drafts without any write action', async () => {
    perms.canEdit = false;
    vi.stubGlobal('fetch', stubFetch(routes(today(twoDrafts()))).fetchStub);
    renderApp();
    const queue = await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    expect(within(queue).getByText(/mẫu áo chị hỏi/)).toBeInTheDocument();
    expect(within(queue).queryByRole('button')).toBeNull();
  });
});

describe('Today: "AI đã làm" and "Rapiz đã mang lại"', () => {
  it('lists the reported sends in a collapsed section', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        routes(today([]), {
          'GET /today/ai-done': {
            status: 200,
            body: {
              count: 1,
              items: [
                {
                  careMessageId: CARE,
                  conversationId: CONV,
                  customerName: 'Chị Hoa',
                  avatarUrl: null,
                  channel: 'instagram',
                  template: 'ready',
                  text: 'Chị Hoa ơi, shop gửi lại cách đặt hàng ạ.',
                  sentAt: iso(-H),
                  repliedAt: iso(-30 * 60_000),
                },
              ],
            },
          },
        }),
      ).fetchStub,
    );
    renderApp();
    const user = userEvent.setup();
    const trigger = await screen.findByRole(
      'button',
      { name: /AI đã làm hôm nay · 1 tin/ },
      { timeout: 5000 },
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Chị Hoa')).toBeNull();
    await user.click(trigger);
    expect(await screen.findByText('Chị Hoa')).toBeInTheDocument();
    expect(screen.getByText('Khách đã trả lời')).toBeInTheDocument();
  });

  it('shows the impact for 30 days by default, then for another range', async () => {
    const stub = stubFetch(
      routes(today([]), {
        'GET /brain/impact?range=7d': {
          status: 200,
          body: impact({
            range: '7d',
            followUpsSent: 0,
            ai: { orders: 1, revenue: 450_000 },
            aiStaff: { orders: 0, revenue: 0 },
          }),
        },
      }),
    );
    vi.stubGlobal('fetch', stub.fetchStub);
    renderApp();
    const user = userEvent.setup();
    expect(
      await screen.findByText(
        '30 ngày qua Rapiz đã mang lại 12 đơn · 8,4 triệu',
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/AI tự chốt 8 đơn · 5,1 triệu — AI \+ nhân viên 4 đơn · 3,3 triệu/),
    ).toBeInTheDocument();
    expect(screen.getByText(/40 tin chăm sóc, 12 khách trả lời/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '7 ngày' }));
    expect(
      await screen.findByText(/7 ngày qua Rapiz đã mang lại 1 đơn · 450\.000/),
    ).toBeInTheDocument();
  });

  it('explains the strip when there is nothing yet, and hides it from roles without analytics', async () => {
    const empty = impact({
      followUpsSent: 0,
      repliesReceived: 0,
      ai: { orders: 0, revenue: 0 },
      aiStaff: { orders: 0, revenue: 0 },
    });
    vi.stubGlobal(
      'fetch',
      stubFetch(routes(today([]), { 'GET /brain/impact?range=30d': { status: 200, body: empty } }))
        .fetchStub,
    );
    renderApp();
    expect(
      await screen.findByText(/Chưa có đơn nào nhờ AI/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Rapiz đã mang lại \d/)).toBeNull();
  });

  it('does not ask for the impact without analytics', async () => {
    perms.analytics = false;
    const stub = stubFetch(routes(today([])));
    vi.stubGlobal('fetch', stub.fetchStub);
    renderApp();
    await screen.findByRole('region', { name: 'Chờ duyệt' }, { timeout: 5000 });
    expect(screen.queryByRole('radio', { name: '30 ngày' })).toBeNull();
    expect(stub.calls.some((c) => c.key.startsWith('GET /brain/impact'))).toBe(false);
  });
});
