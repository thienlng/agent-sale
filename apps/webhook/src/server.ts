import type { ChannelKind, ChannelRegistry, NormalizedEvent } from '@agent-sales/channels';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Ingress ports. Production adapters: Postgres `inbound_events` (+ key table for
 * dedup) and BullMQ. In-memory versions are used in tests.
 */
export interface IngressStore {
  /** Returns false when the (kind, externalEventId) pair was already stored. */
  storeOnce(
    kind: ChannelKind,
    externalEventId: string,
    raw: unknown,
    event?: NormalizedEvent,
  ): Promise<boolean>;
}
export interface IngressQueue {
  enqueue(kind: ChannelKind, externalEventId: string): Promise<void>;
}

export interface ServerDeps {
  registry: ChannelRegistry;
  store: IngressStore;
  queue: IngressQueue;
  /** Secret per channel kind for signature verification (from channel config in production). */
  secrets: Partial<Record<ChannelKind, string>>;
  logLevel?: string;
  verifyToken?: string;
}

const KINDS: ChannelKind[] = [
  'facebook',
  'instagram',
  'zalo_oa',
  'tiktok',
  'lazada',
  'website',
  'email',
];

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: { level: deps.logLevel ?? 'info' }, trustProxy: true });

  // Keep the raw body for signature verification.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, { raw: body, json: JSON.parse(body as string) as unknown });
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.get<{ Querystring: Record<string, string> }>('/webhooks/:kind', async (req, reply) => {
    if (
      !deps.verifyToken ||
      req.query['hub.mode'] !== 'subscribe' ||
      req.query['hub.verify_token'] !== deps.verifyToken
    )
      return reply.code(403).send({ error: 'verification failed' });
    const challenge = req.query['hub.challenge'];
    if (!challenge || !/^[0-9]{1,100}$/.test(challenge))
      return reply.code(400).send({ error: 'invalid challenge' });
    return reply.type('text/plain').send(challenge);
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post<{ Params: { kind: string }; Body: { raw: string; json: unknown } }>(
    '/webhooks/:kind',
    async (req, reply) => {
      const kind = req.params.kind as ChannelKind;
      if (!KINDS.includes(kind)) return reply.code(404).send({ error: 'unknown channel' });
      const adapter = deps.registry.get(kind);
      const secret = deps.secrets[kind] ?? '';
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
      );
      if (!adapter.verifyWebhook(headers, req.body.raw, secret)) {
        return reply.code(401).send({ error: 'invalid signature' });
      }
      const events = adapter.parseWebhook(req.body.json);
      let stored = 0;
      for (const ev of events) {
        if (await deps.store.storeOnce(kind, ev.externalEventId, ev.raw, ev)) {
          await deps.queue.enqueue(kind, ev.externalEventId);
          stored += 1;
        }
      }
      // Always 200 fast: platforms retry on non-2xx (docs/04 §6).
      return reply.code(200).send({ received: events.length, stored });
    },
  );

  return app;
}
