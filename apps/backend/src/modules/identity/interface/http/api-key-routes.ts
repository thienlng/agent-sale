import { allRoutes, apiKeyRoutes, type RouteContract } from '@agent-sales/contracts';

import { API_PREFIX } from '../../../../common/http/api-prefix.js';

/** `GET /api/v1/contacts/:id`: a contract route as `<method> <req.routeOptions.url>`. */
export const routeKey = (method: string, path: string): string =>
  `${method.toUpperCase()} /${API_PREFIX}${path.replace(/\{(\w+)\}/g, ':$1')}`;

/** Fastify route patterns an API key may call: the contracts marked `apiKey: true` (ADR-022 §1). */
export function apiKeyRouteSet(routes: readonly RouteContract[] = allRoutes): ReadonlySet<string> {
  return new Set(apiKeyRoutes(routes).map((r) => routeKey(r.method, r.path)));
}
