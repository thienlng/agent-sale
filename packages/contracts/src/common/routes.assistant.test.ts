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

  it('only marks GET routes as `read`', () => {
    const bad = routes.filter((r) => r.assistant?.use === 'read' && r.method !== 'get');
    expect(bad.map(routeKey)).toEqual([]);
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
