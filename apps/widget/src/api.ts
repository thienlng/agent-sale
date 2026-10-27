import type {
  WidgetConfig,
  WidgetPollResponse,
  WidgetSendRequest,
  WidgetSendResponse,
  WidgetUploadResponse,
} from './types.js';

export interface ApiResponse<T> {
  /** HTTP status; 0 on a network error. */
  status: number;
  body: T | null;
  retryAfter: number | null;
  code: string | null;
}

export interface UploadContext {
  firstUrl?: string;
  referrer?: string;
  pageUrl?: string;
  pageTitle?: string;
}

export interface Api {
  config(): Promise<ApiResponse<WidgetConfig>>;
  send(token: string | null, body: WidgetSendRequest): Promise<ApiResponse<WidgetSendResponse>>;
  poll(token: string, after: string | null): Promise<ApiResponse<WidgetPollResponse>>;
  /** Without a token the upload starts the visitor; `context` then fills its first page data. */
  upload(
    token: string | null,
    file: Blob,
    context?: UploadContext,
  ): Promise<ApiResponse<WidgetUploadResponse>>;
  phone(token: string, phone: string): Promise<ApiResponse<{ phoneCaptured: boolean }>>;
}

export function createApi(origin: string, siteKey: string): Api {
  const base = `${origin.replace(/\/+$/, '')}/api/v1/webchat/v1/sites/${encodeURIComponent(siteKey)}`;

  async function call<T>(
    path: string,
    init: RequestInit,
    token: string | null,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
    if (token) headers['Authorization'] = `Visitor ${token}`;
    try {
      const res = await fetch(base + path, { ...init, headers, credentials: 'omit' });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const ra = Number(res.headers.get('Retry-After'));
      const code =
        body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : null;
      return {
        status: res.status,
        body: res.ok ? (body as T) : null,
        retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null,
        code,
      };
    } catch {
      return { status: 0, body: null, retryAfter: null, code: null };
    }
  }

  const json = (data: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return {
    config: () => call('', { method: 'GET' }, null),
    send: (token, body) => call('/messages', json(body), token),
    poll: (token, after) =>
      call(
        `/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`,
        { method: 'GET' },
        token,
      ),
    upload: (token, file, context) => {
      const form = new FormData();
      form.append('file', file, 'image.jpg');
      const query = new URLSearchParams();
      if (!token && context)
        for (const [name, value] of Object.entries(context)) if (value) query.set(name, value);
      const qs = query.toString();
      return call(`/uploads${qs ? `?${qs}` : ''}`, { method: 'POST', body: form }, token);
    },
    phone: (token, phone) => call('/phone', json({ phone }), token),
  };
}
