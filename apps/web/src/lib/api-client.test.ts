import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { stubFetch } from '@/testing/render';

import {
  api,
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
