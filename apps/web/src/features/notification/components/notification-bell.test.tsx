import type { NotificationDto } from '@agent-sales/contracts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAssistantOpenRequests } from '@/lib/assistant-context';
import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { badgeText, NotificationBell } from './notification-bell';

const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => WS }));

const RUN = '01a19d25-57b8-7082-bbf9-35da4e0c3001';
const note = (over: Partial<NotificationDto> = {}): NotificationDto => ({
  id: '01a19d25-57b8-7082-bbf9-35da4e0c3100',
  type: 'assistant.alert',
  title: '3 đơn hàng mới · Shop An',
  body: 'Tổng giá trị: 450.000 ₫',
  target: { kind: 'path', path: '/app/orders' },
  workspaceId: WS,
  readAt: null,
  createdAt: new Date(Date.now() - 120_000).toISOString(),
  ...over,
});

function renderBell() {
  const root = createRootRoute({ component: () => <NotificationBell /> });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([any]),
    history: createMemoryHistory({ initialEntries: ['/app/bots'] }),
  });
  renderWithProviders(<RouterProvider router={router} />);
  return router;
}

function stub(items: NotificationDto[], count = items.filter((n) => !n.readAt).length) {
  const s = stubFetch({
    'GET /notifications/unread-count': { status: 200, body: { count } },
    'GET /notifications?limit=20': { status: 200, body: { items, next: null } },
    ...Object.fromEntries(
      items.map((n) => [
        `POST /notifications/${n.id}/read`,
        { status: 200, body: { ...n, readAt: new Date().toISOString() } },
      ]),
    ),
    'POST /notifications/read-all': { status: 200, body: { count: items.length } },
  });
  vi.stubGlobal('fetch', s.fetchStub);
  return s;
}

beforeAll(async () => {
  await Promise.all([import('./notification-list'), loadNamespace('notification')]);
});
beforeEach(() => {
  const { result } = renderHook(() => useAssistantOpenRequests());
  if (result.current.request) result.current.consume(result.current.request.seq);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('badgeText', () => {
  it('is hidden at 0 and caps at 9+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(3)).toBe('3');
    expect(badgeText(12)).toBe('9+');
  });
});

describe('NotificationBell', () => {
  it('shows the unread badge, and no badge at zero', async () => {
    stub([note()], 12);
    renderBell();
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('9+');
    expect(screen.getByRole('button', { name: 'Thông báo, 12 chưa đọc' })).toBeInTheDocument();
  });

  it('hides the badge when nothing is unread', async () => {
    const { calls } = stub([], 0);
    renderBell();
    await waitFor(() =>
      expect(calls.map((c) => c.key)).toContain('GET /notifications/unread-count'),
    );
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('marks a path notification read and navigates there', async () => {
    const { calls } = stub([note()]);
    const router = renderBell();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thông báo/ }));
    await user.click(await screen.findByText('3 đơn hàng mới · Shop An'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/orders'));
    expect(calls.map((c) => c.key)).toContain(`POST /notifications/${note().id}/read`);
  });

  it('opens the conversation of an inbox alert in its business', async () => {
    const CONV = '01a19d25-57b8-7082-bbf9-35da4e0c3200';
    stub([
      note({
        type: 'inbox.handoff',
        title: 'Lan cần nhân viên hỗ trợ',
        target: { kind: 'conversation', conversationId: CONV },
      }),
    ]);
    const router = renderBell();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thông báo/ }));
    await user.click(await screen.findByText('Lan cần nhân viên hỗ trợ'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/inbox'));
    expect(router.state.location.search).toEqual({ conversation: CONV, ws: WS });
  });

  it('does not navigate to an unsafe path', async () => {
    const { calls } = stub([note({ target: { kind: 'path', path: 'https://evil.example' } })]);
    const router = renderBell();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thông báo/ }));
    await user.click(await screen.findByText('3 đơn hàng mới · Shop An'));
    await waitFor(() =>
      expect(calls.map((c) => c.key)).toContain(`POST /notifications/${note().id}/read`),
    );
    expect(router.state.location.pathname).toBe('/app/bots');
  });

  it('asks the assistant to open a report thread', async () => {
    stub([
      note({
        type: 'assistant.report',
        title: 'Doanh thu hôm qua · Shop An',
        target: { kind: 'assistant_report', runId: RUN },
      }),
    ]);
    const requests = renderHook(() => useAssistantOpenRequests());
    renderBell();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thông báo/ }));
    await user.click(await screen.findByText('Doanh thu hôm qua · Shop An'));
    await waitFor(() =>
      expect(requests.result.current.request).toMatchObject({ reportRunId: RUN }),
    );
  });

  it('marks everything read', async () => {
    const { calls } = stub([note()]);
    renderBell();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thông báo/ }));
    await user.click(await screen.findByRole('button', { name: 'Đánh dấu tất cả đã đọc' }));
    await waitFor(() => expect(calls.map((c) => c.key)).toContain('POST /notifications/read-all'));
  });

  it('shows the empty state', async () => {
    stub([]);
    renderBell();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thông báo' }));
    expect(await screen.findByText('Chưa có thông báo nào.')).toBeInTheDocument();
  });
});
