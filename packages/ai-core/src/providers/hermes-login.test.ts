import { describe, expect, it, vi } from 'vitest';

import { HermesLoginClient, HermesLoginError } from './hermes-login.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(transport: typeof fetch) {
  return new HermesLoginClient({
    baseURL: 'http://127.0.0.1:8788/',
    apiKey: 'private-bridge-key',
    fetch: transport,
  });
}

describe('HermesLoginClient', () => {
  it('rejects unsafe URLs and a missing key', () => {
    expect(() => new HermesLoginClient({ baseURL: 'ftp://x', apiKey: 'k' })).toThrow();
    expect(() => new HermesLoginClient({ baseURL: 'http://u:p@x', apiKey: 'k' })).toThrow();
    expect(() => new HermesLoginClient({ baseURL: 'http://x?a=1', apiKey: 'k' })).toThrow();
    expect(() => new HermesLoginClient({ baseURL: 'http://x' })).toThrow();
  });

  it('reads status with the bearer key and no redirects', async () => {
    const transport = vi.fn().mockResolvedValue(json({ state: 'signed_in' }));
    expect(await client(transport).status()).toEqual({ state: 'signed_in' });
    expect(transport.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8788/v1/auth/status');
    const init = transport.mock.calls[0]?.[1] as RequestInit;
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: 'Bearer private-bridge-key' },
    });
  });

  it('starts a login and returns the device code', async () => {
    const pending = {
      state: 'pending',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
      expiresAt: '2026-10-24T10:00:00Z',
    };
    const transport = vi.fn().mockResolvedValue(json(pending));
    expect(await client(transport).start()).toEqual(pending);
    expect(transport.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8788/v1/auth/start');
    expect((transport.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
  });

  it('logs out', async () => {
    const transport = vi.fn().mockResolvedValue(json({ state: 'signed_out' }));
    expect(await client(transport).logout()).toEqual({ state: 'signed_out' });
    expect(transport.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8788/v1/auth/logout');
  });

  it('reports an unreachable bridge as a state, without leaking the error', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.9'));
    expect(await client(transport).status()).toEqual({ state: 'unreachable' });
  });

  it('maps bridge error statuses to typed failures', async () => {
    const cases: Array<[number, string]> = [
      [401, 'unauthorized'],
      [429, 'rate_limited'],
      [503, 'unavailable'],
    ];
    for (const [status, reason] of cases) {
      const transport = vi.fn().mockResolvedValue(json({ error: 'x' }, status));
      await expect(client(transport).start()).rejects.toMatchObject({
        constructor: HermesLoginError,
        reason,
      });
    }
  });

  it('rejects malformed or oversized responses', async () => {
    await expect(
      client(vi.fn().mockResolvedValue(json({ state: 'weird' }))).status(),
    ).rejects.toMatchObject({ reason: 'invalid' });
    await expect(
      client(vi.fn().mockResolvedValue(new Response('x'.repeat(20_000)))).status(),
    ).rejects.toMatchObject({ reason: 'invalid' });
  });
});
