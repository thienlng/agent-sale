import { createHash, createHmac } from 'node:crypto';

import { ChannelRegistry, MetaAdapter } from '@agent-sales/channels';
import { describe, expect, it } from 'vitest';

import {
  KIOTVIET_BODY_LIMIT,
  redactUrl,
  type KiotVietDelivery,
  type KiotVietIngressStore,
} from './kiotviet.js';
import { buildServer } from './server.js';

const TOKEN = 'A'.repeat(21) + '_-' + 'b9'.repeat(10); // 43 chars, base64url alphabet
const DEAD = 'Z'.repeat(43);

function memoryStore(): KiotVietIngressStore & { rows: (KiotVietDelivery & { token: string })[] } {
  const rows: (KiotVietDelivery & { token: string })[] = [];
  return {
    rows,
    async store(token, delivery) {
      if (token === DEAD || token !== TOKEN) return 'unknown';
      if (rows.some((r) => r.token === token && r.deliveryId === delivery.deliveryId))
        return 'duplicate';
      rows.push({ token, ...delivery });
      return 'stored';
    },
  };
}

function harness(kiotviet: ReturnType<typeof memoryStore> = memoryStore()) {
  const meta: string[] = [];
  const logs: string[] = [];
  const app = buildServer({
    registry: new ChannelRegistry().register(new MetaAdapter('facebook')),
    store: {
      storeOnce: async (_k, id) => {
        meta.push(id);
        return true;
      },
    },
    queue: { enqueue: async () => undefined },
    secrets: { facebook: 'meta-secret' },
    verifyToken: 'verify-me',
    kiotviet,
    logLevel: 'info',
    logStream: { write: (line) => void logs.push(line) },
  });
  return { app, kiotviet, meta, logs: () => logs.join('') };
}

const post = (
  app: ReturnType<typeof harness>['app'],
  payload: string,
  headers: Record<string, string> = { 'content-type': 'application/json' },
  token = TOKEN,
) => app.inject({ method: 'POST', url: `/webhooks/kiotviet/${token}`, headers, payload });

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('KiotViet webhook ingress', () => {
  it('stores the raw body byte-exact with its signature and answers 200', async () => {
    const { app, kiotviet } = harness();
    // Odd spacing and key order must survive: the worker verifies the HMAC over this exact string.
    const body = '{ "Id":"d-1",  "Attempt":1,"Notifications":[{"Action":"product.update.1"}] }';
    const res = await post(app, body, {
      'content-type': 'application/json',
      'x-hub-signature': 'abc123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(kiotviet.rows).toEqual([{ token: TOKEN, deliveryId: 'd-1', body, signature: 'abc123' }]);
  });

  it('stores a duplicate delivery Id once and still answers 200', async () => {
    const { app, kiotviet } = harness();
    const body = JSON.stringify({ Id: 'd-2', Notifications: [] });
    expect((await post(app, body)).json()).toEqual({ ok: true });
    const again = await post(app, body);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ ok: true });
    expect(kiotviet.rows).toHaveLength(1);
  });

  it('accepts a numeric Id', async () => {
    const { app, kiotviet } = harness();
    await post(app, '{"Id":12345}');
    expect(kiotviet.rows[0]?.deliveryId).toBe('12345');
  });

  it('uses the body sha256 as delivery id when Id is missing, unusable or the JSON is malformed', async () => {
    const { app, kiotviet } = harness();
    const noId = '{"Notifications":[]}';
    const longId = JSON.stringify({ Id: 'x'.repeat(300) });
    const broken = '{"Id":"d-3", oops';
    for (const b of [noId, longId, broken]) expect((await post(app, b)).statusCode).toBe(200);
    expect(kiotviet.rows.map((r) => r.deliveryId)).toEqual([
      sha256(noId),
      sha256(longId),
      sha256(broken),
    ]);
    expect(kiotviet.rows[2]?.body).toBe(broken);
  });

  it('stores a delivery without a signature (the worker drops it)', async () => {
    const { app, kiotviet } = harness();
    expect((await post(app, '{"Id":"d-4"}')).statusCode).toBe(200);
    expect(kiotviet.rows[0]?.signature).toBeNull();
  });

  it('keeps the raw string for non-JSON content types and no content type', async () => {
    const { app, kiotviet } = harness();
    const a = '{"Id":"t-1"}';
    const b = '{"Id":"t-2"}';
    const c = '{"Id":"t-3"}';
    await post(app, a, { 'content-type': 'text/plain' });
    await post(app, b, { 'content-type': 'application/json; charset=utf-8' });
    await post(app, c, {});
    expect(kiotviet.rows.map((r) => [r.deliveryId, r.body])).toEqual([
      ['t-1', a],
      ['t-2', b],
      ['t-3', c],
    ]);
  });

  it('answers 410 to a malformed token, an unknown token and a disconnected connection', async () => {
    const { app, kiotviet } = harness();
    const body = '{"Id":"d-5"}';
    expect((await post(app, body, undefined, 'short')).statusCode).toBe(410);
    expect((await post(app, body, undefined, 'A'.repeat(42) + '!')).statusCode).toBe(410);
    expect((await post(app, body, undefined, 'Q'.repeat(43))).statusCode).toBe(410);
    expect((await post(app, body, undefined, DEAD)).statusCode).toBe(410);
    expect(kiotviet.rows).toHaveLength(0);
  });

  it('answers 413 over 1 MiB', async () => {
    const { app, kiotviet } = harness();
    const big = JSON.stringify({ Id: 'big', pad: 'x'.repeat(KIOTVIET_BODY_LIMIT) });
    expect((await post(app, big)).statusCode).toBe(413);
    expect(kiotviet.rows).toHaveLength(0);
  });

  it('leaves the Meta routes as they were', async () => {
    const { app, meta } = harness();
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: '123',
          time: 1800000000,
          messaging: [
            {
              sender: { id: '999' },
              recipient: { id: '123' },
              timestamp: 1800000000,
              message: { mid: 'm-1', text: 'hi' },
            },
          ],
        },
      ],
    });
    const signature = 'sha256=' + createHmac('sha256', 'meta-secret').update(body).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/facebook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(meta).toEqual(['m-1']);
    // Meta's JSON parser still rejects malformed JSON (its pre-existing 500, never stored).
    const bad = await app.inject({
      method: 'POST',
      url: '/webhooks/facebook',
      headers: { 'content-type': 'application/json' },
      payload: '{oops',
    });
    expect(bad.statusCode).toBe(500);
    expect(meta).toEqual(['m-1']);
    // The verification handshake still works, and a KiotViet URL never reaches it.
    const hs = await app.inject({
      method: 'GET',
      url: '/webhooks/facebook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42',
    });
    expect(hs.body).toBe('42');
    const kvGet = await app.inject({
      method: 'GET',
      url: `/webhooks/kiotviet/${TOKEN}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`,
    });
    expect(kvGet.statusCode).toBe(404);
    // A token-less KiotViet POST falls through to the channel route and is unknown there.
    expect(
      (await app.inject({ method: 'POST', url: '/webhooks/kiotviet', payload: { Id: 'x' } }))
        .statusCode,
    ).toBe(404);
  });

  it('redacts the path token from logged URLs', () => {
    expect(redactUrl(`/webhooks/kiotviet/${TOKEN}?a=1`)).toBe('/webhooks/kiotviet/[redacted]?a=1');
    expect(redactUrl('/webhooks/facebook')).toBe('/webhooks/facebook');
  });

  it('stores multi-byte Vietnamese and BOM-prefixed bodies byte-exact', async () => {
    const { app, kiotviet } = harness();
    const vi = '{"Id":"vi-1","Notifications":[{"Data":[{"Name":"Áo dài lụa – đỏ thẫm 🌸"}]}]}';
    const bom = '﻿{"Id":"vi-2","Name":"Nón lá"}';
    for (const b of [vi, bom]) {
      const res = await post(app, b, { 'content-type': 'application/json; charset=utf-8' });
      expect(res.statusCode).toBe(200);
    }
    expect(kiotviet.rows.map((r) => r.body)).toEqual([vi, bom]);
    expect(Buffer.from(kiotviet.rows[0]!.body, 'utf8').equals(Buffer.from(vi, 'utf8'))).toBe(true);
    expect(Buffer.from(kiotviet.rows[1]!.body, 'utf8').equals(Buffer.from(bom, 'utf8'))).toBe(true);
  });

  it('answers 500 on a store failure without logging the token or the body', async () => {
    const body = '{"Id":"secret-delivery","Customer":"Nguyễn Văn A 0901234567"}';
    const failing = memoryStore();
    failing.store = async (token, delivery) => {
      // What drizzle-orm's DrizzleQueryError message looks like.
      const err = new Error(
        `Failed query: select ... where webhook_token = $1\nparams: ${token},${delivery.body}`,
      ) as Error & { cause?: unknown };
      err.name = 'DrizzleQueryError';
      err.cause = Object.assign(new Error(`invalid byte sequence near ${delivery.body}`), {
        code: '22021',
      });
      throw err;
    };
    const { app, logs } = harness(failing);
    const res = await post(app, body);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(TOKEN);
    expect(res.body).not.toContain('Nguyễn');
    const out = logs();
    expect(out).toContain('kiotviet_ingress_failed');
    expect(out).toContain('22021');
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('Nguyễn');
    expect(out).not.toContain('secret-delivery');
  });

  it('redacts the token from the request log of a real request', async () => {
    const { app, logs } = harness();
    expect((await post(app, '{"Id":"log-1"}')).statusCode).toBe(200);
    const out = logs();
    expect(out).toContain('/webhooks/kiotviet/[redacted]');
    expect(out).not.toContain(TOKEN);
  });

  it('logs not-found KiotViet URLs redacted, keeping Meta answers', async () => {
    const { app, logs } = harness();
    const misses = [
      { method: 'GET' as const, url: `/webhooks/kiotviet/${TOKEN}` },
      { method: 'POST' as const, url: `/webhooks/kiotviet/${TOKEN}/` },
      { method: 'POST' as const, url: `/webhooks/kiotviet/${TOKEN}/extra` },
    ];
    for (const m of misses) {
      const res = await app.inject(m.method === 'POST' ? { ...m, payload: '{}' } : m);
      expect(res.statusCode).toBe(404);
    }
    const out = logs();
    expect(out).toContain('route_not_found');
    expect(out).not.toContain(TOKEN);
    // Meta's own 404 for an unknown channel is unchanged.
    const meta = await app.inject({ method: 'POST', url: '/webhooks/nope', payload: { id: 'x' } });
    expect(meta.json()).toEqual({ error: 'unknown channel' });
  });

  it('logs a 413 without the body', async () => {
    const { app, logs } = harness();
    const big = JSON.stringify({ Id: 'big', pad: 'Đ'.repeat(KIOTVIET_BODY_LIMIT) });
    expect((await post(app, big)).statusCode).toBe(413);
    const out = logs();
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('ĐĐĐ');
  });
});
