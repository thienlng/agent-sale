import { type MembershipDto } from '@agent-sales/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getWorkspaceId, setWorkspaceId } from '@/lib/api-client';

import { resolveFilters } from '../lib/filters';
import { readPortfolio } from './portfolio';

const date = '2026-10-24';
const now = `${date}T08:00:00.000Z`;
const memberships: MembershipDto[] = [
  {
    workspaceId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21',
    workspaceName: 'Business A',
    role: 'owner',
    industry: 'retail',
    accountId: null,
    accountName: null,
  },
  {
    workspaceId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d22',
    workspaceName: 'Business B',
    role: 'sales',
    industry: 'retail',
    accountId: null,
    accountName: null,
  },
];
const filters = resolveFilters({ from: date, to: date });
const answer = (metrics: string[], value: number, scope = 'all') => ({
  meta: {
    definitionVersion: 1,
    timezone: 'Asia/Ho_Chi_Minh',
    range: { from: date, to: date, fromUtc: `${date}T00:00:00Z`, toUtc: `${date}T23:59:59Z` },
    asOf: now,
    generatedAt: now,
    watermarkId: 42,
    watermarkAt: now,
    lagSeconds: 0,
    scope,
  },
  cards: metrics.map((key) => ({ key, state: 'ok', value })),
  series: [{ date, values: Object.fromEntries(metrics.map((key) => [key, value])) }],
  breakdowns: { tags: [], currentTags: [], statuses: [], bySales: [], byPage: [] },
  distinctTotals: {},
});
afterEach(() => {
  vi.unstubAllGlobals();
  setWorkspaceId(null);
});

describe('authorized business portfolio reads', () => {
  it('keeps explicit tenant headers, all customer sources and each business permission scope', async () => {
    const calls: Array<{ workspace: string; metrics: string[]; origins?: string[] }> = [];
    setWorkspaceId('selected-business');
    vi.stubGlobal('fetch', async (_input: string, init: RequestInit) => {
      const workspace = (init.headers as Record<string, string>)['X-Workspace-Id'] ?? '';
      const body = JSON.parse(String(init.body)) as { metrics: string[]; origins?: string[] };
      calls.push({ workspace, ...body });
      return new Response(
        JSON.stringify(
          answer(
            body.metrics,
            workspace.endsWith('21') ? 2 : 7,
            workspace.endsWith('22') ? 'own' : 'all',
          ),
        ),
      );
    });
    const rows = await readPortfolio(memberships, filters, new AbortController().signal);
    expect(rows.map((row) => row.state)).toEqual(['ready', 'ready']);
    expect(rows[1]?.people?.meta.scope).toBe('own');
    expect(rows[0]?.people?.cards[0]).toMatchObject({ value: 2 });
    expect(rows[1]?.people?.cards[0]).toMatchObject({ value: 7 });
    expect(
      calls
        .filter((call) => call.metrics.includes('customers.new'))
        .every((call) => call.origins?.join(',') === 'channel,manual,import'),
    ).toBe(true);
    expect(new Set(calls.map((call) => call.workspace))).toEqual(
      new Set(memberships.map((m) => m.workspaceId)),
    );
    expect(getWorkspaceId()).toBe('selected-business');
  });

  it('keeps a failed or forbidden business unavailable instead of returning a zero', async () => {
    vi.stubGlobal('fetch', async (_input: string, init: RequestInit) => {
      const workspace = (init.headers as Record<string, string>)['X-Workspace-Id'];
      if (workspace === memberships[1]?.workspaceId)
        return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'denied' } }), {
          status: 403,
        });
      const body = JSON.parse(String(init.body)) as { metrics: string[] };
      return new Response(JSON.stringify(answer(body.metrics, 2)));
    });
    const rows = await readPortfolio(memberships, filters, new AbortController().signal);
    expect(rows[0]?.state).toBe('ready');
    expect(rows[1]).toEqual({ business: memberships[1], state: 'error' });
  });

  it('does not send requests for a membership without analytics permission', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const rows = await readPortfolio(
      [{ ...(memberships[0] as MembershipDto), role: 'unknown' }],
      filters,
      new AbortController().signal,
    );
    expect(rows[0]?.state).toBe('forbidden');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bounds concurrency to three tenant reads even for a large portfolio', async () => {
    let active = 0,
      maximum = 0;
    vi.stubGlobal('fetch', async (_input: string, init: RequestInit) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      const body = JSON.parse(String(init.body)) as { metrics: string[] };
      return new Response(JSON.stringify(answer(body.metrics, 1)));
    });
    const business = memberships[0] as MembershipDto;
    const rows = await readPortfolio(
      Array.from({ length: 9 }, (_, i) => ({
        ...business,
        workspaceId: `${business.workspaceId.slice(0, -1)}${i}`,
      })),
      filters,
      new AbortController().signal,
    );
    expect(rows).toHaveLength(9);
    expect(maximum).toBeLessThanOrEqual(3);
  });

  it('stops queued work when the portfolio is canceled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(readPortfolio(memberships, filters, controller.signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
