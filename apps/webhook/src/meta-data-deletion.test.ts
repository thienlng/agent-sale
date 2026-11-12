import { ChannelRegistry, metaUserHash, signRequest } from '@agent-sales/channels';
import { describe, expect, it } from 'vitest';

import type { MetaDataDeletionStore } from './meta-data-deletion.js';
import { signedRequestOf } from './meta-data-deletion.js';
import { buildServer } from './server.js';

const secret = 'app-secret-for-tests';
const userId = '10234567890123456';
const payload = { algorithm: 'HMAC-SHA256', issued_at: 1_794_466_800, user_id: userId };

/** In-memory store with the same rule as Postgres: one pending request per user hash. */
function memoryStore() {
  const pending = new Map<string, string>();
  const calls: string[] = [];
  const store: MetaDataDeletionStore = {
    request: async (hash) => {
      calls.push(hash);
      const code = pending.get(hash) ?? `CODE${pending.size + 1}AAAAAAAAAAAA`;
      pending.set(hash, code);
      return { confirmationCode: code };
    },
  };
  return { store, calls };
}

function harness() {
  const lines: string[] = [];
  const { store, calls } = memoryStore();
  const app = buildServer({
    registry: new ChannelRegistry(),
    store: { storeOnce: async () => true },
    queue: { enqueue: async () => undefined },
    secrets: {},
    logLevel: 'info',
    logStream: { write: (l) => void lines.push(l) },
    metaDataDeletion: { store, appSecret: secret, statusOrigin: 'https://rapiz.io/' },
  });
  return { app, calls, lines };
}

const post = (app: ReturnType<typeof harness>['app'], body: string, type: string) =>
  app.inject({
    method: 'POST',
    url: '/meta/data-deletion',
    headers: { 'content-type': type },
    payload: body,
  });

describe('POST /meta/data-deletion', () => {
  it('answers the status URL and a confirmation code for a valid signed request', async () => {
    const { app, calls, lines } = harness();
    const signed = signRequest(payload, secret);
    const res = await post(
      app,
      new URLSearchParams({ signed_request: signed }).toString(),
      'application/x-www-form-urlencoded',
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string; confirmation_code: string };
    expect(body.confirmation_code).toMatch(/^[A-Za-z0-9]+$/);
    expect(body.url).toBe(`https://rapiz.io/data-deletion?code=${body.confirmation_code}`);
    // Only the hash is handed on; neither the id nor the signed request is logged.
    expect(calls).toEqual([metaUserHash(userId)]);
    expect(lines.join('\n')).not.toContain(userId);
    expect(lines.join('\n')).not.toContain(signed.slice(0, 20));
  });

  it('gives the same code when the same person asks twice', async () => {
    const { app, calls } = harness();
    const form = new URLSearchParams({ signed_request: signRequest(payload, secret) }).toString();
    const first = (await post(app, form, 'application/x-www-form-urlencoded')).json();
    const again = (await post(app, form, 'application/x-www-form-urlencoded')).json();
    expect(again).toEqual(first);
    expect(calls).toHaveLength(2);
  });

  it('accepts a JSON body', async () => {
    const { app } = harness();
    const res = await post(
      app,
      JSON.stringify({ signed_request: signRequest(payload, secret) }),
      'application/json',
    );
    expect(res.statusCode).toBe(200);
  });

  it('refuses a tampered, foreign-signed, wrong-algorithm or missing request with 400', async () => {
    const { app, calls } = harness();
    const signed = signRequest(payload, secret);
    const [sig] = signed.split('.');
    const forged = `${sig}.${Buffer.from(JSON.stringify({ ...payload, user_id: '1' })).toString('base64url')}`;
    for (const bad of [
      forged,
      signRequest(payload, 'another-secret'),
      signRequest({ ...payload, algorithm: 'none' }, secret),
    ]) {
      const res = await post(
        app,
        new URLSearchParams({ signed_request: bad }).toString(),
        'application/x-www-form-urlencoded',
      );
      expect(res.statusCode).toBe(400);
    }
    expect((await post(app, '', 'application/x-www-form-urlencoded')).statusCode).toBe(400);
    expect((await post(app, 'other=1', 'application/x-www-form-urlencoded')).statusCode).toBe(400);
    expect((await post(app, '{nope', 'application/json')).statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('is absent when not configured', async () => {
    const app = buildServer({
      registry: new ChannelRegistry(),
      store: { storeOnce: async () => true },
      queue: { enqueue: async () => undefined },
      secrets: {},
      logLevel: 'silent',
    });
    const res = await app.inject({ method: 'POST', url: '/meta/data-deletion', payload: 'x' });
    expect(res.statusCode).toBe(404);
  });
});

describe('signedRequestOf', () => {
  it('reads the form field and the JSON field', () => {
    expect(signedRequestOf('signed_request=a.b', 'application/x-www-form-urlencoded')).toBe('a.b');
    expect(signedRequestOf('{"signed_request":"a.b"}', 'application/json; charset=utf-8')).toBe(
      'a.b',
    );
    expect(signedRequestOf(undefined, undefined)).toBeNull();
  });
});
