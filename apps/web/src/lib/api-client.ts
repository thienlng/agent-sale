import { ErrorResponse } from '@agent-sales/contracts';
import type { z } from 'zod';

/**
 * The ONE place that talks to the API (raw `fetch` is lint-banned elsewhere).
 * Access token lives in memory only (docs/09); the refresh cookie is sent
 * automatically to /auth/refresh by the browser.
 */
let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; workspaceId?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (init.workspaceId) headers['X-Workspace-Id'] = init.workspaceId;

  const request: RequestInit = { method: init.method ?? 'GET', headers, credentials: 'include' };
  if (init.body !== undefined) request.body = JSON.stringify(init.body);
  const res = await fetch(`/api/v1${path}`, request);
  const json: unknown = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(json);
    const e = parsed.success ? parsed.data.error : { code: 'INTERNAL', message: res.statusText };
    throw new ApiClientError(
      res.status,
      e.code,
      e.message,
      parsed.success ? parsed.data.error.traceId : undefined,
    );
  }
  return schema.parse(json);
}
