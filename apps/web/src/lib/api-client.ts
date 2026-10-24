import { AuthResponse, ErrorResponse } from '@agent-sales/contracts';
import type { z } from 'zod';

/**
 * The ONE place that talks to the API (raw `fetch` is lint-banned elsewhere).
 * The access token lives in memory only (docs/09); the HttpOnly refresh cookie
 * is sent by the browser to /auth/refresh. A 401 triggers one silent refresh
 * and a retry; if that fails the session is over.
 */
let accessToken: string | null = null;
let workspaceId: string | null = null;
let onSessionExpired: () => void = () => {};

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function setWorkspaceId(id: string | null): void {
  workspaceId = id;
}
export function getWorkspaceId(): string | null {
  return workspaceId;
}
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId?: string,
    /** Machine-readable specifics (e.g. which fields are missing). */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function send(path: string, method: Method, body: unknown, scoped: boolean) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (scoped && workspaceId) headers['X-Workspace-Id'] = workspaceId;
  const init: RequestInit = { method, headers, credentials: 'include' };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(`/api/v1${path}`, init);
}

async function toError(res: Response): Promise<ApiClientError> {
  const json: unknown = await res.json().catch(() => null);
  const parsed = ErrorResponse.safeParse(json);
  if (!parsed.success) return new ApiClientError(res.status, 'INTERNAL', res.statusText);
  const e = parsed.data.error;
  return new ApiClientError(res.status, e.code, e.message, e.traceId, e.details);
}

let refreshing: Promise<AuthResponse | null> | null = null;

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await send('/auth/refresh', 'POST', { client: 'web' }, false);
      if (!res.ok) return null;
      const auth = AuthResponse.parse(await res.json());
      accessToken = auth.accessToken;
      return auth;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: Method; body?: unknown; workspaceScoped?: boolean } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const scoped = init.workspaceScoped ?? true;
  let res = await send(path, method, init.body, scoped);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      res = await send(path, method, init.body, scoped);
    } else {
      accessToken = null;
      onSessionExpired();
    }
  }
  if (!res.ok) throw await toError(res);
  return schema.parse(res.status === 204 ? null : await res.json());
}
