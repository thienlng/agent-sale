import { METRIC_DEFINITIONS } from '@agent-sales/contracts';

/** Statistics fixtures with long Vietnamese names and large numbers, for the layout guard. */
const now = '2026-10-24T08:00:00.000Z';
const id = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a${String(n).padStart(2, '0')}`;
const LONG = 'Nguyễn Thị Thanh Hương Lan Anh Phương Thảo Ngọc Bích Khách hàng thân thiết nhiều năm';
export const TAG_IDS = [id(1), id(2), id(3)];
export const PAGE_IDS = [id(11), id(12)];
const SALES = id(21);

const meta = {
  definitionVersion: 1,
  timezone: 'Asia/Ho_Chi_Minh',
  range: {
    from: '2026-10-18',
    to: '2026-10-24',
    fromUtc: '2026-10-17T17:00:00.000Z',
    toUtc: '2026-10-24T17:00:00.000Z',
  },
  asOf: now,
  generatedAt: now,
  watermarkId: 123456,
  watermarkAt: now,
  lagSeconds: 95,
  scope: 'all',
};
const days = Array.from({ length: 7 }, (_, i) => `2026-10-${18 + i}`);

function query(metrics: string[]) {
  const has = (m: string) => metrics.includes(m);
  return {
    meta,
    cards: metrics.map((key, i) => ({ key, state: 'ok', value: 98_765_432 - i * 1_234_567 })),
    series: days.map((date, i) => ({
      date,
      values: Object.fromEntries(metrics.map((k) => [k, (i + 1) * 12_345])),
    })),
    breakdowns: {
      tags: has('tags.assigned')
        ? TAG_IDS.map((tagId, i) => ({
            tagId,
            assigned: 9_000_000 - i,
            removed: 1_000 * i,
            net: 8_999_000,
          }))
        : [],
      currentTags: has('tags.current')
        ? TAG_IDS.map((tagId, i) => ({ tagId, count: 5_000 - i }))
        : [],
      statuses: has('statuses.current')
        ? [
            { statusId: null, count: 4_000_000 },
            { statusId: id(31), count: 2_345_678 },
          ]
        : [],
      bySales: has('customers.new')
        ? [
            {
              salesUserId: SALES,
              values: { 'customers.new': 1_234_567, 'phones.captured': 999_999 },
            },
            { salesUserId: null, values: { 'customers.new': 765_432, 'phones.captured': 1 } },
          ]
        : [],
      byPage: has('messages.inbound')
        ? PAGE_IDS.map((channelId, i) => ({
            channelId,
            values: {
              'conversations.opened': 123_456 + i,
              'messages.inbound': 9_876_543 - i,
              'messages.outbound': 8_765_432,
            },
          }))
        : [],
    },
    distinctTotals: has('tags.current') ? { 'tags.current': 4_999 } : {},
  };
}

export function analyticsRoute(path: string, body: Record<string, unknown> | null): unknown {
  if (path === '/analytics/definitions') return { version: 1, definitions: METRIC_DEFINITIONS };
  if (path === '/analytics/query') return query((body?.['metrics'] as string[]) ?? []);
  if (path === '/analytics/drilldown') {
    return {
      meta,
      metric: body?.['metric'] ?? 'customers.new',
      total: 3_456_789,
      rows: Array.from({ length: 6 }, (_, i) => ({
        at: now,
        contactId: id(40 + i),
        contactName: `${LONG} ${i}`,
        conversationId: null,
        channelId: null,
        tagId: null,
        statusId: null,
        salesUserId: null,
      })),
      nextCursor: `${now}|9`,
    };
  }
  if (path === '/channels') {
    return {
      data: PAGE_IDS.map((channelId, i) => ({
        id: channelId,
        provider: 'facebook',
        externalId: `ext-${i}`,
        name: `Trang bán hàng ${LONG} ${i}`,
        status: 'connected',
        botId: null,
        expiresAt: null,
        createdAt: now,
      })),
      providers: [],
    };
  }
  if (path === '/crm/assignees') {
    return {
      data: [
        { userId: SALES, name: `${LONG} (Sales)`, role: 'sales' },
        { userId: id(22), name: 'Sales Bình', role: 'sales' },
      ],
    };
  }
  return undefined;
}
