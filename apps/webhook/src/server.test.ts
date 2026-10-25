import { createHmac } from 'node:crypto';
import {
  MetaAdapter,
  type NormalizedEvent,
  type ChannelAdapter,
  ChannelRegistry,
} from '@agent-sales/channels';
import { describe, expect, it } from 'vitest';

import { buildServer } from './server.js';

function fakeAdapter(valid: boolean): ChannelAdapter {
  return {
    kind: 'website',
    verifyWebhook: () => valid,
    parseWebhook: (body) => {
      const b = body as { id: string };
      return [
        {
          kind: 'website',
          assetExternalId: 'site-1',
          externalEventId: b.id,
          type: 'message',
          senderExternalId: 'visitor-1',
          occurredAt: new Date(),
          text: 'hi',
          raw: body,
        },
      ];
    },
    send: async () => ({ externalMessageId: 'm' }),
    capabilities: () => ({
      richCards: true,
      quickReplies: true,
      media: true,
      replyWindowHours: null,
    }),
    mapError: () => ({ code: 'unknown', retryable: false }),
  };
}

function harness(valid = true) {
  const seen = new Set<string>();
  const enqueued: string[] = [];
  const app = buildServer({
    registry: new ChannelRegistry().register(fakeAdapter(valid)),
    store: {
      storeOnce: async (_k, id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      },
    },
    queue: { enqueue: async (_k, id) => void enqueued.push(id) },
    secrets: { website: 's' },
    verifyToken: 'verify-me',
    logLevel: 'silent',
  });
  return { app, enqueued };
}

describe('webhook ingress', () => {
  it('answers the subscription handshake only with the right verify token', async () => {
    const { app } = harness();
    const get = (token: string, challenge = '12345') =>
      app.inject({
        method: 'GET',
        url: `/webhooks/website?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=${challenge}`,
      });
    const ok = await get('verify-me');
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('12345');
    expect((await get('wrong')).statusCode).toBe(403);
    expect((await get('verify-m')).statusCode).toBe(403);
    expect((await get('verify-me', '<script>')).statusCode).toBe(400);
  });

  it('stores and enqueues a new event once, acks duplicates with 200', async () => {
    const { app, enqueued } = harness();
    const first = await app.inject({
      method: 'POST',
      url: '/webhooks/website',
      payload: { id: 'evt-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/webhooks/website',
      payload: { id: 'evt-1' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: 1, stored: 1 });
    expect(second.json()).toEqual({ received: 1, stored: 0 });
    expect(enqueued).toEqual(['evt-1']);
  });

  it('rejects an invalid signature with 401 and unknown channels with 404', async () => {
    const { app } = harness(false);
    expect(
      (await app.inject({ method: 'POST', url: '/webhooks/website', payload: { id: 'x' } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/webhooks/nope', payload: { id: 'x' } }))
        .statusCode,
    ).toBe(404);
  });
});

describe('signed Facebook comment ingress', () => {
  it('stores a signed comment with post provenance exactly once and rejects tampering', async () => {
    const seen = new Set<string>(),
      stored: NormalizedEvent[] = [];
    const app = buildServer({
      registry: new ChannelRegistry().register(new MetaAdapter('facebook')),
      secrets: { facebook: 'test-secret' },
      logLevel: 'silent',
      store: {
        storeOnce: async (_kind, id, _raw, event) => {
          if (seen.has(id)) return false;
          seen.add(id);
          if (event) stored.push(event);
          return true;
        },
      },
      queue: { enqueue: async () => undefined },
    });
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: '123',
          time: 1800000000,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                post_id: '123_10',
                comment_id: '10_20',
                parent_id: '123_10',
                from: { id: '999' },
                message: 'How much?',
              },
            },
          ],
        },
      ],
    });
    const signature = 'sha256=' + createHmac('sha256', 'test-secret').update(body).digest('hex');
    try {
      const send = (payload: string) =>
        app.inject({
          method: 'POST',
          url: '/webhooks/facebook',
          headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
          payload,
        });
      expect((await send(body)).json()).toEqual({ received: 1, stored: 1 });
      expect((await send(body)).json()).toEqual({ received: 1, stored: 0 });
      expect((await send(body.replace('How much?', 'Tampered'))).statusCode).toBe(401);
      expect(stored).toEqual([
        expect.objectContaining({
          type: 'comment',
          comment: { postId: '123_10', commentId: '10_20', parentId: null, operation: 'add' },
        }),
      ]);
    } finally {
      await app.close();
    }
  });
});
