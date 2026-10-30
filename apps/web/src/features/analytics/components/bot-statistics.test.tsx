import { METRIC_DEFINITIONS } from '@agent-sales/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isoDate } from '@/lib/format';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { daysAgo } from '../lib/filters';
import { BotStatistics } from './bot-statistics';

const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));

const PAGE_A = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d0a';
const PAGE_B = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d0b';
const NOW = '2026-10-24T08:00:00.000Z';

const answer = {
  meta: {
    definitionVersion: 1,
    timezone: 'Asia/Ho_Chi_Minh',
    range: { from: '2026-10-18', to: '2026-10-24', fromUtc: NOW, toUtc: NOW },
    asOf: NOW,
    generatedAt: NOW,
    watermarkId: 1,
    watermarkAt: NOW,
    lagSeconds: 0,
    scope: 'all',
  },
  cards: [
    { key: 'conversations.opened', state: 'ok', value: 12 },
    { key: 'messages.inbound', state: 'ok', value: 345 },
    { key: 'messages.outbound', state: 'ok', value: 678 },
  ],
  series: [],
  breakdowns: { tags: [], currentTags: [], statuses: [], bySales: [], byPage: [] },
  distinctTotals: {},
};

function setup() {
  const { fetchStub, calls } = stubFetch({
    'GET /analytics/definitions': {
      status: 200,
      body: { version: 1, definitions: METRIC_DEFINITIONS },
    },
    'POST /analytics/query': { status: 200, body: answer },
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

const queries = (calls: ReturnType<typeof setup>) =>
  calls
    .filter((c) => c.key === 'POST /analytics/query')
    .map((c) => c.body as Record<string, unknown>);

beforeEach(() => {
  can.value = true;
});

describe('BotStatistics', () => {
  it("shows the bot's conversation figures for its pages over the last 7 days", async () => {
    const calls = setup();
    renderWithRouter(() => <BotStatistics botId="b1" pageIds={[PAGE_A, PAGE_B]} />);

    expect(await screen.findByText('345')).toBeVisible();
    expect(screen.getByText('12')).toBeVisible();
    expect(screen.getByText('678')).toBeVisible();
    // The same query the statistics page sends for its conversation cards, scoped to the pages.
    expect(queries(calls)).toEqual([
      expect.objectContaining({
        metrics: ['conversations.opened', 'messages.inbound', 'messages.outbound'],
        pageIds: [PAGE_A, PAGE_B],
        dateRange: { from: daysAgo(6), to: isoDate(new Date()) },
      }),
    ]);
    const full = screen.getByRole('link', { name: 'Xem chi tiết trong Thống kê' });
    const url = new URL(full.getAttribute('href') ?? '', 'http://x');
    expect(url.pathname).toBe('/app/analytics');
    expect(url.searchParams.get('pages')).toContain(PAGE_A);
  });

  it('re-queries for the last 30 days and keeps the link in step', async () => {
    const calls = setup();
    renderWithRouter(() => <BotStatistics botId="b1" pageIds={[PAGE_A]} />);
    await screen.findByText('345');

    await userEvent.click(screen.getByRole('radio', { name: '30 ngày' }));

    await waitFor(() =>
      expect(queries(calls).at(-1)).toMatchObject({ dateRange: { from: daysAgo(29) } }),
    );
    const href = screen
      .getByRole('link', { name: 'Xem chi tiết trong Thống kê' })
      .getAttribute('href');
    expect(new URL(href ?? '', 'http://x').searchParams.get('from')).toContain(daysAgo(29));
  });

  it('never falls back to workspace-wide numbers for a bot without pages', async () => {
    const calls = setup();
    renderWithRouter(() => <BotStatistics botId="b1" pageIds={[]} />);

    expect(await screen.findByText(/chưa gắn kênh nào/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Gắn kênh' })).toHaveAttribute(
      'href',
      '/app/bots/b1/integrations',
    );
    expect(queries(calls)).toEqual([]);
  });

  it('stays hidden for members who cannot view statistics', async () => {
    can.value = false;
    const calls = setup();
    renderWithRouter(() => <BotStatistics botId="b1" pageIds={[PAGE_A]} />);

    await waitFor(() => expect(screen.queryByText('Hiệu quả của bot')).toBeNull());
    expect(queries(calls)).toEqual([]);
  });
});
