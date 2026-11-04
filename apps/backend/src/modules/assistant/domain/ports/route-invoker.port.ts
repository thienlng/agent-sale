/**
 * One request to a declared `/api/v1` route, run in process with the caller's own credentials
 * (ruling 1b-R2): the real auth guard, membership, capabilities and RLS apply. `authorization`
 * lives in memory only; it is never stored or logged.
 */
export interface RouteInvocation {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  businessId: string;
  authorization: string;
  idempotencyKey?: string;
}
export interface RouteInvocationResult {
  status: number;
  body: unknown;
}
export interface RouteInvoker {
  invoke(i: RouteInvocation): Promise<RouteInvocationResult>;
}
export const ROUTE_INVOKER = Symbol('ROUTE_INVOKER');
