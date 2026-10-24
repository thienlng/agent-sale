import { METRIC_DEFINITIONS } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { login } from '@/lib/session';
import { renderWithRouter } from '@/testing/render';

import type { FiltersSearch } from '../lib/filters';
import { StatisticsPage } from './statistics-page';

const WS = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const USER = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d02';
const SALES = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d03';
const TAG = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d04';
const CONTACT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d05';
const NOW = '2026-10-24T08:00:00.000Z';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const meta = (extra: object = {}) => ({
  definitionVersion: 1,
  timezone: 'Asia/Ho_Chi_Minh',
  range: {
    from: '2026-10-18',
    to: '2026-10-24',
    fromUtc: '2026-10-17T17:00:00.000Z',
    toUtc: '2026-10-24T17:00:00.000Z',
  },
  asOf: NOW,
  generatedAt: NOW,
  watermarkId: 42,
  watermarkAt: NOW,
  lagSeconds: 0,
  scope: 'all',
  ...extra,
});
const days = ['2026-10-22', '2026-10-23', '2026-10-24'];

function answer(metrics: string[], overrides: Record<string, unknown> = {}, m: object = {}) {
  return {
    meta: meta(m),
    cards: metrics.map((key, i) => overrides[key] ?? { key, state: 'ok', value: (i + 1) * 3 }),
    series: days.map((date, i) => ({
      date,
      values: Object.fromEntries(metrics.map((k) => [k, i])),
    })),
    breakdowns: {
      tags: metrics.includes('tags.assigned')
        ? [{ tagId: TAG, assigned: 5, removed: 2, net: 3 }]
        : [],
      currentTags: metrics.includes('tags.current') ? [{ tagId: TAG, count: 2 }] : [],
      statuses: [],
      bySales: [],
      byPage: [],
    },
    distinctTotals: {},
  };
}

interface Setup {
  /** Replace the answer for a group (by first metric). */
  failGroup?: string;
  overrides?: Record<string, unknown>;
  scope?: 'own' | 'all';
}

const requests: Array<{ path: string; body: Record<string, unknown> }> = [];

function install(role: string, setup: Setup = {}) {
  requests.length = 0;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const path = input.replace('/api/v1', '');
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    requests.push({ path, body });
    if (path === '/auth/login') {
      return json({
        accessToken: 'a.b.c',
        expiresIn: 900,
        user: {
          id: USER,
          email: 'lan@shop.vn',
          name: 'Lan',
          phone: null,
          emailVerified: true,
          locale: 'vi',
          timezone: 'Asia/Ho_Chi_Minh',
          isPlatformAdmin: false,
        },
      });
    }
    if (path === '/bootstrap') {
      return json({
        user: {
          id: USER,
          email: 'lan@shop.vn',
          name: 'Lan',
          phone: null,
          emailVerified: true,
          locale: 'vi',
          timezone: 'Asia/Ho_Chi_Minh',
          isPlatformAdmin: false,
        },
        memberships: [{ workspaceId: WS, workspaceName: 'Shop', role }],
      });
    }
    if (path === '/analytics/definitions')
      return json({ version: 1, definitions: METRIC_DEFINITIONS });
    if (path === '/crm/assignees') {
      return json({ data: [{ userId: SALES, name: 'Sales Bình', role: 'sales' }] });
    }
    if (path === '/channels') return json({ data: [], providers: [] });
    if (path === '/crm/tags') {
      return json({
        data: [
          {
            id: TAG,
            name: 'VIP',
            color: '#000000',
            type: 'classification',
            description: '',
            fields: [],
            schemaVersion: 1,
            isSystem: false,
            archived: false,
            createdByName: null,
            activeCount: 0,
            version: 1,
            updatedAt: NOW,
          },
        ],
      });
    }
    if (path === '/crm/statuses') return json({ data: [] });
    if (path === '/analytics/query') {
      const metrics = body['metrics'] as string[];
      if (setup.failGroup && metrics.includes(setup.failGroup)) {
        return json({ error: { code: 'INTERNAL', message: 'boom' } }, 500);
      }
      return json(answer(metrics, setup.overrides ?? {}, { scope: setup.scope ?? 'all' }));
    }
    if (path === '/analytics/drilldown') {
      const cursor = body['cursor'];
      return json({
        meta: meta(),
        metric: body['metric'],
        total: 2,
        rows: cursor
          ? [
              {
                at: NOW,
                contactId: CONTACT,
                contactName: 'Khách hai',
                conversationId: null,
                channelId: null,
                tagId: null,
                statusId: null,
                salesUserId: null,
              },
            ]
          : [
              {
                at: NOW,
                contactId: CONTACT,
                contactName: 'Khách một',
                conversationId: null,
                channelId: null,
                tagId: null,
                statusId: null,
                salesUserId: null,
              },
            ],
        nextCursor: cursor ? null : `${NOW}|7`,
      });
    }
    throw new Error(`unexpected request ${path}`);
  });
}

async function show(role = 'owner', setup: Setup = {}) {
  install(role, setup);
  await login({ email: 'lan@shop.vn', password: 'x' });
  return renderWithRouter(() => <StatisticsPage search={{}} onSearch={() => {}} />);
}

const queryBodies = () => requests.filter((r) => r.path === '/analytics/query').map((r) => r.body);
const byFirst = (key: string) => queryBodies().find((b) => (b['metrics'] as string[])[0] === key);

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe('StatisticsPage', () => {
  it('shows every number from three queries, each asked only for the filters it supports', async () => {
    await show();
    expect(await screen.findByRole('heading', { name: 'Khách hàng mới' })).toBeInTheDocument();
    await waitFor(() => expect(queryBodies()).toHaveLength(3));

    const people = byFirst('customers.new');
    expect(people).toMatchObject({
      definitionVersion: 1,
      origins: ['channel', 'manual', 'import'],
    });
    expect(people).not.toHaveProperty('pageIds');
    expect(byFirst('tags.assigned')).not.toHaveProperty('origins');
    expect(byFirst('conversations.opened')).not.toHaveProperty('salesIds');

    // customers.new is the first metric of its query: value 3.
    const card = screen
      .getByRole('heading', { name: 'Khách hàng mới' })
      .closest('div[class*="rounded-lg"]');
    expect(card).not.toBeNull();
    expect(await within(card as HTMLElement).findByText('3')).toBeInTheDocument();
    expect(screen.getByText(/Múi giờ Asia\/Ho_Chi_Minh/)).toBeInTheDocument();
  });

  it('a metric without a data source says so, instead of showing 0', async () => {
    await show();
    await screen.findByRole('heading', { name: 'Bình luận' });
    expect(screen.getByText('Chưa có nguồn dữ liệu')).toBeInTheDocument();
    // It is never asked for.
    expect(queryBodies().flatMap((b) => b['metrics'] as string[])).not.toContain(
      'comments.received',
    );
  });

  it('a locked number is shown as locked, not as 0', async () => {
    await show('owner', {
      overrides: { 'statuses.current': { key: 'statuses.current', state: 'locked' } },
    });
    expect(await screen.findByText('Gói hiện tại chưa gồm số liệu này')).toBeInTheDocument();
  });

  it('a failed query says it could not be loaded and offers a retry; the others still show', async () => {
    await show('owner', { failGroup: 'customers.new' });
    // The query retries once (1 s) before it counts as failed.
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('Không tải được số liệu');
    expect(alert).toHaveTextContent('Đây không phải là 0');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    // Customer cards show the failure; tag cards (another query) still have their number.
    const customers = screen
      .getByRole('heading', { name: 'Khách hàng mới' })
      .closest('div[class*="rounded-lg"]');
    expect(
      within(customers as HTMLElement).getByText('Không tải được số liệu'),
    ).toBeInTheDocument();
    expect(within(customers as HTMLElement).queryByText('0')).toBeNull();
  });

  it('opens the rows behind a number with the same filters and data as the card', async () => {
    await show();
    await userEvent.click(await screen.findByRole('button', { name: /Chi tiết: Khách hàng mới/ }));
    expect(await screen.findByText('Khách một')).toBeInTheDocument();
    expect(screen.getByText(/2 mục — bằng đúng số trên thẻ/)).toBeInTheDocument();
    const drill = requests.find((r) => r.path === '/analytics/drilldown');
    expect(drill?.body).toMatchObject({
      metric: 'customers.new',
      query: {
        metrics: ['customers.new'],
        watermark: 42,
        origins: ['channel', 'manual', 'import'],
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    expect(await screen.findByText('Khách hai')).toBeInTheDocument();
  });

  it('a row of the tag table opens its own drilldown, narrowed to that tag', async () => {
    await show();
    // The tag is in both tables (events in the range, and tags now on customers): the first is the events one.
    const rows = await screen.findAllByRole('button', { name: 'VIP' }, { timeout: 4000 });
    expect(rows).toHaveLength(2);
    await userEvent.click(rows[0] as HTMLElement);
    await waitFor(() =>
      expect(requests.find((r) => r.path === '/analytics/drilldown')?.body).toMatchObject({
        metric: 'tags.assigned',
        dimension: { tagId: TAG },
      }),
    );
  });

  it('explains an invalid range and sends nothing', async () => {
    install('owner');
    await login({ email: 'lan@shop.vn', password: 'x' });
    renderWithRouter(() => (
      <StatisticsPage search={{ from: '2026-10-24', to: '2026-10-01' }} onSearch={() => {}} />
    ));
    expect(await screen.findByText('Ngày bắt đầu phải trước ngày kết thúc.')).toBeInTheDocument();
    expect(queryBodies()).toHaveLength(0);
  });

  it('a salesperson sees their own scope and no salesperson picker', async () => {
    await show('sales', { scope: 'own' });
    expect(await screen.findByText(/Chỉ gồm khách bạn phụ trách/)).toBeInTheDocument();
    expect(screen.queryByText('Nhân viên Sales')).toBeNull();
  });

  it("does not present the previous filters' numbers as the new ones while they load", async () => {
    install('owner');
    await login({ email: 'lan@shop.vn', password: 'x' });
    const inner = globalThis.fetch;
    // The page sends three queries; every one of them is held.
    const releases: Array<() => void> = [];
    let hold = false;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (hold && String(input).endsWith('/analytics/query')) {
        await new Promise<void>((r) => releases.push(r));
      }
      return inner(input, init);
    });
    function Harness() {
      const [search, setSearch] = useState<FiltersSearch>({});
      return <StatisticsPage search={search} onSearch={setSearch} />;
    }
    renderWithRouter(() => <Harness />);

    const customers = () =>
      screen
        .getByRole('heading', { name: 'Khách hàng mới' })
        .closest('div[class*="rounded-lg"]') as HTMLElement;
    await screen.findByRole('heading', { name: 'Khách hàng mới' });
    expect(await within(customers()).findByText('3')).toBeInTheDocument();

    hold = true;
    await userEvent.click(screen.getByRole('button', { name: '30 ngày' }));
    // The old answer is still cached, but it is for other dates: no number is shown for the new range.
    await waitFor(() => expect(within(customers()).queryByText('3')).toBeNull());
    expect(within(customers()).queryByText('0')).toBeNull();
    // And nothing can be opened from it.
    expect(screen.queryByRole('button', { name: /Chi tiết: Khách hàng mới/ })).toBeNull();

    hold = false;
    for (const release of releases) release();
    expect(await within(customers()).findByText('3')).toBeInTheDocument();
  });
});
