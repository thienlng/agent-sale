import { describe, expect, it } from 'vitest';

import { allRoutes } from '../index.js';
import { routeKey, type RouteContract } from './routes.js';

/**
 * Architecture test for the owner assistant (T-170): every workspace-scoped
 * route declares whether the assistant may read it, propose writes to it, or
 * never touch it. A new route without a ruling fails here.
 */
const routes: readonly RouteContract[] = allRoutes;
const scoped = routes.filter((r) => r.workspaceScoped);

describe('route assistant annotations', () => {
  it('declares `assistant` on every workspace-scoped route', () => {
    const missing = scoped.filter((r) => !r.assistant).map(routeKey);
    expect(missing).toEqual([]);
  });

  it('gives every read/write route a non-empty `when` of at most 160 chars', () => {
    const bad = scoped
      .filter((r) => r.assistant && r.assistant.use !== 'never')
      .filter((r) => {
        const when = r.assistant?.when?.trim() ?? '';
        return when.length === 0 || when.length > 160;
      })
      .map(routeKey);
    expect(bad).toEqual([]);
  });

  it('only marks GET routes, or POST routes flagged `queryPost`, as `read`', () => {
    const bad = routes.filter(
      (r) =>
        r.assistant?.use === 'read' &&
        r.method !== 'get' &&
        !(r.method === 'post' && r.assistant.queryPost),
    );
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('flags `queryPost` only on POST routes marked `read`', () => {
    const bad = routes.filter(
      (r) => r.assistant?.queryPost && (r.method !== 'post' || r.assistant.use !== 'read'),
    );
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('never marks a GET route as `write`', () => {
    const bad = routes.filter((r) => r.assistant?.use === 'write' && r.method === 'get');
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('never lets the assistant read or write a route that is not workspace-scoped', () => {
    const bad = routes.filter(
      (r) => !r.workspaceScoped && r.assistant !== undefined && r.assistant.use !== 'never',
    );
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('reads the side-effect-free query POSTs (ruling 1b-R7)', () => {
    const queryPosts = routes.filter((r) => r.assistant?.queryPost).map(routeKey);
    expect(queryPosts.sort()).toEqual(
      [
        'POST /analytics/drilldown',
        'POST /analytics/query',
        'POST /contacts/query',
        'POST /lodging/availability',
        'POST /lodging/quote',
        'POST /products/match-codes',
        'POST /stay-requests/quote',
      ].sort(),
    );
  });

  it('never lets the assistant use /assistant or /auth routes', () => {
    const bad = routes.filter(
      (r) =>
        (r.path.startsWith('/assistant') || r.path.startsWith('/auth')) &&
        r.assistant !== undefined &&
        r.assistant.use !== 'never',
    );
    expect(bad.map(routeKey)).toEqual([]);
  });

  it('builds route keys as `METHOD /path`', () => {
    expect(routeKey({ method: 'patch', path: '/products/{id}' })).toBe('PATCH /products/{id}');
  });
});
