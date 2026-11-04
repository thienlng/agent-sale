import { allRoutes, type RouteContract } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { buildRouteCatalog, searchCatalog } from '../application/route-catalog.js';

/** The crm request routes (T-187), as `crm.routes.ts` declares them; added when missing. */
const REQUEST_ROUTES: RouteContract[] = [
  {
    method: 'get',
    path: '/crm/requests/summary',
    summary: 'Customer request summary',
    tag: 'crm',
    auth: true,
    workspaceScoped: true,
    responses: { 200: null },
    assistant: {
      use: 'read',
      when: 'Customer requests (demo, trial, placement test, appointment) recorded by the bot: counts per customer status and the latest open ones.',
    },
  },
];
const have = new Set(allRoutes.map((r) => `${r.method} ${r.path}`));
const CATALOG = buildRouteCatalog([
  ...allRoutes,
  ...REQUEST_ROUTES.filter((r) => !have.has(`${r.method} ${r.path}`)),
]);
const top = (query: string, industry?: string): string[] =>
  searchCatalog(CATALOG, query, undefined, [], industry).map((e) => e.key);

describe('route catalog: the service group (T-187)', () => {
  it.each(['education', 'spa'])(
    'ranks the request summary first for "khách đặt lịch" on %s',
    (i) => {
      expect(top('khách đặt lịch', i)[0]).toBe('GET /crm/requests/summary');
      expect(top('bao nhiêu khách đăng ký học thử', i)[0]).toBe('GET /crm/requests/summary');
      expect(top('khách kiểm tra trình độ', i)[0]).toBe('GET /crm/requests/summary');
    },
  );

  it.each(['education', 'spa'])(
    'ranks the catalog first for course and service words on %s',
    (i) => {
      for (const query of ['khoá học', 'dịch vụ', 'liệu trình', 'các lớp']) {
        expect(top(query, i)[0], query).toMatch(/ \/products/);
      }
    },
  );

  it('leaves other industries without the request widening', () => {
    expect(top('khách đặt lịch', 'retail')).not.toContain('GET /crm/requests/summary');
    expect(top('khách đặt lịch')).not.toContain('GET /crm/requests/summary');
  });
});
