import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { stubFetch } from '@/testing/render';

import {
  api,
  apiUpload,
  ApiClientError,
  setAccessToken,
  setSessionExpiredHandler,
  setWorkspaceId,
} from './api-client';

const user = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
  email: 'lan@shop.vn',
  name: 'Lan',
  phone: null,
  emailVerified: false,
  locale: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  isPlatformAdmin: false,
};
const refreshed = { accessToken: 'new-token', expiresIn: 900, user };

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setWorkspaceId(null);
});

describe('api()', () => {
  it('sends the token and workspace header, and parses with the schema', async () => {
    const { fetchStub, calls } = stubFetch({ 'GET /bots': { status: 200, body: { ok: true } } });
    vi.stubGlobal('fetch', fetchStub);
    setAccessToken('t1');
    setWorkspaceId('ws-1');
    await expect(api('/bots', z.object({ ok: z.boolean() }))).resolves.toEqual({ ok: true });
    expect(calls[0]?.headers).toMatchObject({
      Authorization: 'Bearer t1',
      'X-Workspace-Id': 'ws-1',
    });
  });

  it('parses an accepted request without a body as null', async () => {
    const { fetchStub } = stubFetch({ 'POST /jobs': { status: 202 } });
    vi.stubGlobal('fetch', fetchStub);
    await expect(api('/jobs', z.null(), { method: 'POST' })).resolves.toBeNull();
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    let first = true;
    const { fetchStub, calls } = stubFetch({
      'POST /auth/refresh': { status: 200, body: refreshed },
    });
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (input.endsWith('/bots')) {
        const status = first ? 401 : 200;
        first = false;
        return new Response(
          JSON.stringify(
            status === 200 ? { ok: true } : { error: { code: 'UNAUTHENTICATED', message: 'x' } },
          ),
          {
            status,
          },
        );
      }
      return fetchStub(input, init);
    });
    setAccessToken('expired');
    await expect(api('/bots', z.object({ ok: z.boolean() }))).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.key)).toEqual(['POST /auth/refresh']);
  });

  it('ends the session when the refresh fails', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    const { fetchStub } = stubFetch({
      'GET /bots': { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } },
      'POST /auth/refresh': {
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', message: 'x' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    await expect(api('/bots', z.unknown())).rejects.toBeInstanceOf(ApiClientError);
    expect(expired).toHaveBeenCalledOnce();
  });

  it('exposes the shared error envelope', async () => {
    const { fetchStub } = stubFetch({
      'POST /bots/x/playground': {
        status: 503,
        body: { error: { code: 'AI_UNAVAILABLE', message: 'No AI model', traceId: 'req-1' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const error = await api('/bots/x/playground', z.unknown(), { method: 'POST', body: {} }).catch(
      (e) => e,
    );
    expect(error).toMatchObject({ status: 503, code: 'AI_UNAVAILABLE', traceId: 'req-1' });
  });
});

describe('tenant context across portfolio reads and retries', () => {
  it('pins the original workspace through token refresh when the selection changes', async () => {
    const seen: string[] = [];
    let first = true;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (input.endsWith('/auth/refresh')) {
        setWorkspaceId('business-b');
        return new Response(JSON.stringify(refreshed));
      }
      seen.push((init?.headers as Record<string, string>)['X-Workspace-Id'] ?? '');
      if (first) {
        first = false;
        return new Response('{}', { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true }));
    });
    setWorkspaceId('business-a');
    await api('/analytics/query', z.object({ ok: z.boolean() }));
    expect(seen).toEqual(['business-a', 'business-a']);
  });

  it('reads another business explicitly without changing the active workspace', async () => {
    const { fetchStub, calls } = stubFetch({
      'GET /analytics/definitions': { status: 200, body: {} },
    });
    vi.stubGlobal('fetch', fetchStub);
    setWorkspaceId('business-a');
    await api('/analytics/definitions', z.object({}), { workspaceId: 'business-b' });
    await api('/analytics/definitions', z.object({}));
    expect(calls.map((c) => c.headers['X-Workspace-Id'])).toEqual(['business-b', 'business-a']);
  });
});

/** A scripted XMLHttpRequest: reports 50 % upload progress, then answers the next response. */
class FakeXhr {
  static responses: { status: number; body: string }[] = [];
  static sent: FakeXhr[] = [];
  headers: Record<string, string> = {};
  url = '';
  withCredentials = false;
  status = 0;
  statusText = '';
  responseText = '';
  body: FormData | null = null;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  abort() {
    this.onabort?.();
  }
  send(body: FormData) {
    this.body = body;
    FakeXhr.sent.push(this);
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    const next = FakeXhr.responses.shift() ?? { status: 500, body: '' };
    this.status = next.status;
    this.responseText = next.body;
    queueMicrotask(() => this.onload?.());
  }
}

describe('apiUpload()', () => {
  const Schema = z.object({ url: z.string() });
  const file = new Blob(['mp4'], { type: 'video/mp4' });

  it('posts one multipart file with the token and workspace headers, reporting progress', async () => {
    FakeXhr.sent = [];
    FakeXhr.responses = [{ status: 201, body: JSON.stringify({ url: '/media/v.mp4' }) }];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    setAccessToken('t1');
    const progress: number[] = [];
    await expect(
      apiUpload('/lodging/media/videos', Schema, {
        file,
        fileName: 'tour.mp4',
        workspaceId: 'ws-9',
        onProgress: ({ loaded, total }) => progress.push(loaded / total),
      }),
    ).resolves.toEqual({ url: '/media/v.mp4' });
    const xhr = FakeXhr.sent[0];
    expect(xhr?.url).toBe('/api/v1/lodging/media/videos');
    expect(xhr?.withCredentials).toBe(true);
    expect(xhr?.headers).toMatchObject({ Authorization: 'Bearer t1', 'X-Workspace-Id': 'ws-9' });
    expect(xhr?.body?.get('file')).toBeInstanceOf(Blob);
    expect(progress).toEqual([0.5]);
  });

  it('answers the error envelope as an ApiClientError', async () => {
    FakeXhr.sent = [];
    FakeXhr.responses = [
      {
        status: 413,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'too large',
            details: { reason: 'VIDEO_TOO_LARGE' },
            traceId: 't',
          },
        }),
      },
    ];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const error = await apiUpload('/lodging/media/videos', Schema, {
      file,
      fileName: 'a.mp4',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 413, details: { reason: 'VIDEO_TOO_LARGE' } });
  });

  it('refreshes the session once on 401 and retries', async () => {
    FakeXhr.sent = [];
    FakeXhr.responses = [
      { status: 401, body: '' },
      { status: 201, body: JSON.stringify({ url: '/media/v.mp4' }) },
    ];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const { fetchStub } = stubFetch({ 'POST /auth/refresh': { status: 200, body: refreshed } });
    vi.stubGlobal('fetch', fetchStub);
    setAccessToken('old');
    await expect(
      apiUpload('/lodging/media/videos', Schema, { file, fileName: 'a.mp4' }),
    ).resolves.toEqual({
      url: '/media/v.mp4',
    });
    expect(FakeXhr.sent[1]?.headers['Authorization']).toBe('Bearer new-token');
  });
});
