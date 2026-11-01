import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

/**
 * In-process fake of the KiotViet token endpoint and public API (spec §3), on an ephemeral
 * loopback port. Tests mutate `state` to shape answers and read `requests` to assert calls.
 * Shared by the client spec and the sync/connect specs.
 */

export interface FakeKvProduct {
  id: number;
  code: string;
  name: string;
  [field: string]: unknown;
}

export interface FakeKvOnHand {
  productId: number;
  inventories: Array<{ branchId: number; onHand: number; reserved: number }>;
}

export interface FakeKvWebhook {
  id: number;
  type: string;
  url: string;
  secret: string;
}

export interface FakeKiotVietState {
  retailer: string;
  clientId: string;
  clientSecret: string;
  /** `expires_in` of issued tokens, seconds. */
  tokenTtlSeconds: number;
  branches: Array<{ id: number; branchName: string; address?: string | null }>;
  products: FakeKvProduct[];
  /** Answered as `removeId` on /products. */
  removedProductIds: number[];
  onHands: FakeKvOnHand[];
  /** Answered as `removedIds` on /productOnHands. */
  removedOnHandIds: number[];
  webhooks: FakeKvWebhook[];
  /** Statuses answered, in order, by the next token calls (then normal behaviour). */
  tokenFailures: number[];
  /**
   * Statuses answered, in order, by the next API calls (then normal behaviour); an object form
   * adds a `Retry-After` header.
   */
  apiFailures: Array<number | { status: number; retryAfter?: string }>;
  /** API path prefixes answered with 403 (e.g. `/customers`). */
  forbiddenPaths: string[];
}

export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  retailer: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

export interface FakeKiotViet {
  state: FakeKiotVietState;
  /** Every request, token calls included (path `/connect/token`). */
  requests: FakeRequest[];
  tokenUrl: string;
  apiUrl: string;
  /** Number of tokens issued so far. */
  tokensIssued(): number;
  /** Invalidates every issued token, as after a secret rotation. */
  revokeTokens(): void;
  apiRequests(path?: string): FakeRequest[];
  close(): Promise<void>;
}

const defaults = (): FakeKiotVietState => ({
  retailer: 'shopdemo',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  tokenTtlSeconds: 86_400,
  branches: [{ id: 1, branchName: 'Chi nhánh trung tâm', address: '1 Lê Lợi' }],
  products: [],
  removedProductIds: [],
  onHands: [],
  removedOnHandIds: [],
  webhooks: [],
  tokenFailures: [],
  apiFailures: [],
  forbiddenPaths: [],
});

const queryOf = (req: FastifyRequest): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((req.query ?? {}) as Record<string, unknown>)) {
    out[k] = Array.isArray(v) ? v.map(String).join(',') : String(v);
  }
  return out;
};

const pageOf = <T>(items: T[], q: Record<string, string>): { total: number; data: T[] } => {
  const currentItem = Number(q.currentItem ?? 0);
  const pageSize = Math.min(Number(q.pageSize ?? 20), 100);
  return { total: items.length, data: items.slice(currentItem, currentItem + pageSize) };
};

export async function startFakeKiotViet(
  overrides: Partial<FakeKiotVietState> = {},
): Promise<FakeKiotViet> {
  const state: FakeKiotVietState = { ...defaults(), ...overrides };
  const requests: FakeRequest[] = [];
  const validTokens = new Set<string>();
  let issued = 0;
  let nextWebhookId = 1000;

  const app: FastifyInstance = Fastify({ logger: false });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  app.addHook('onRequest', async (req) => {
    requests.push({
      method: req.method,
      path: req.url.split('?')[0] ?? req.url,
      query: queryOf(req),
      retailer: req.headers.retailer as string | undefined,
      authorization: req.headers.authorization,
      body: undefined,
    });
  });
  app.addHook('preHandler', async (req) => {
    const last = requests[requests.length - 1];
    if (last) last.body = req.body;
  });

  app.post('/connect/token', async (req, reply) => {
    const failure = state.tokenFailures.shift();
    if (failure) return reply.code(failure).send({ error: 'fake_failure' });
    const form = (req.body ?? {}) as Record<string, string>;
    if (
      form.grant_type !== 'client_credentials' ||
      form.scopes !== 'PublicApi.Access' ||
      form.client_id !== state.clientId ||
      form.client_secret !== state.clientSecret
    ) {
      return reply.code(400).send({ error: 'invalid_client' });
    }
    issued += 1;
    const token = `tok-${issued}`;
    validTokens.add(token);
    return { access_token: token, expires_in: state.tokenTtlSeconds, token_type: 'Bearer' };
  });

  /** Auth, retailer and failure switches shared by every API route; true when answered. */
  const guard = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const failure = state.apiFailures.shift();
    if (failure) {
      const f = typeof failure === 'number' ? { status: failure } : failure;
      if (f.retryAfter !== undefined) void reply.header('retry-after', f.retryAfter);
      void reply.code(f.status).send({ responseStatus: { errorCode: 'Fake' } });
      return true;
    }
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!validTokens.has(token) || req.headers.retailer !== state.retailer) {
      void reply.code(401).send({ responseStatus: { errorCode: 'Unauthorized' } });
      return true;
    }
    const path = req.url.split('?')[0] ?? '';
    if (state.forbiddenPaths.some((p) => path.startsWith(p))) {
      void reply.code(403).send({ responseStatus: { errorCode: 'Forbidden' } });
      return true;
    }
    return false;
  };

  app.get('/branches', async (req, reply) => {
    if (guard(req, reply)) return reply;
    return pageOf(state.branches, queryOf(req));
  });

  app.get('/products', async (req, reply) => {
    if (guard(req, reply)) return reply;
    const q = queryOf(req);
    const page = pageOf(state.products, q);
    return q.includeRemoveIds === 'true' ? { ...page, removeId: state.removedProductIds } : page;
  });

  app.get('/products/:id', async (req, reply) => {
    if (guard(req, reply)) return reply;
    const id = Number((req.params as { id: string }).id);
    const product = state.products.find((p) => p.id === id);
    if (!product) return reply.code(404).send({ responseStatus: { errorCode: 'NotFound' } });
    return product;
  });

  app.get('/productOnHands', async (req, reply) => {
    if (guard(req, reply)) return reply;
    const q = queryOf(req);
    const branchIds = (q.branchIds ?? '').split(',').filter(Boolean).map(Number);
    const rows = state.onHands.map((r) => ({
      ...r,
      inventories: branchIds.length
        ? r.inventories.filter((i) => branchIds.includes(i.branchId))
        : r.inventories,
    }));
    return { ...pageOf(rows, q), removedIds: state.removedOnHandIds };
  });

  app.get('/webhooks', async (req, reply) => {
    if (guard(req, reply)) return reply;
    return {
      total: state.webhooks.length,
      data: state.webhooks.map((w) => ({ id: w.id, type: w.type, url: w.url, isActive: true })),
    };
  });

  app.post('/webhooks', async (req, reply) => {
    if (guard(req, reply)) return reply;
    const body = (req.body ?? {}) as {
      Webhook?: { Type?: string; Url?: string; Secret?: string };
    };
    const w = body.Webhook;
    if (!w?.Type || !w.Url || !w.Secret) return reply.code(400).send({ error: 'bad_webhook' });
    nextWebhookId += 1;
    state.webhooks.push({ id: nextWebhookId, type: w.Type, url: w.Url, secret: w.Secret });
    return { Id: nextWebhookId, Type: w.Type, Url: w.Url, IsActive: true };
  });

  app.delete('/webhooks/:id', async (req, reply) => {
    if (guard(req, reply)) return reply;
    const id = Number((req.params as { id: string }).id);
    const before = state.webhooks.length;
    state.webhooks = state.webhooks.filter((w) => w.id !== id);
    if (state.webhooks.length === before) return reply.code(404).send({});
    return { message: 'deleted' };
  });

  const address = await app.listen({ host: '127.0.0.1', port: 0 });

  return {
    state,
    requests,
    tokenUrl: `${address}/connect/token`,
    apiUrl: address,
    tokensIssued: () => issued,
    revokeTokens: () => validTokens.clear(),
    apiRequests: (path) =>
      requests.filter(
        (r) => r.path !== '/connect/token' && (path === undefined || r.path === path),
      ),
    close: () => app.close(),
  };
}
