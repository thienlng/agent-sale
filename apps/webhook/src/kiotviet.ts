import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

/** One KiotViet delivery as received; the worker verifies `signature` over `body` (spec §4.6). */
export interface KiotVietDelivery {
  deliveryId: string;
  /** Raw request body, byte-exact — never re-serialized. */
  body: string;
  signature: string | null;
}

/**
 * Ingress port. `unknown` covers a token nobody owns and a disconnected connection:
 * both answer 410 so KiotViet stops calling a dead URL.
 */
export interface KiotVietIngressStore {
  store(token: string, delivery: KiotVietDelivery): Promise<'stored' | 'duplicate' | 'unknown'>;
}

export const KIOTVIET_BODY_LIMIT = 1024 * 1024;
/** `randomBytes(32).toString('base64url')`. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Longer ids would bloat the unique index; such deliveries fall back to the body hash. */
const MAX_DELIVERY_ID = 128;

/**
 * `POST /webhooks/kiotviet/:token` in its own encapsulated scope: every content type
 * (and none) is read as the raw string, so the stored body is exactly what was signed and
 * malformed JSON is still stored (a 4xx would make KiotViet stop calling). Meta's
 * `application/json` parser outside this scope is untouched.
 *
 * The scope also owns its error and not-found logging: the path token is a credential and
 * the body may carry customer data, so neither reaches a log line (rule 07).
 */
export function registerKiotVietRoute(app: FastifyInstance, store: KiotVietIngressStore): void {
  void app.register(
    async (scope) => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
      });

      scope.setErrorHandler((err: unknown, req, reply) => {
        const status = statusOf(err);
        const summary = safeErrorSummary(err);
        if (status >= 500) req.log.error({ error: summary }, 'kiotviet_ingress_failed');
        else req.log.info({ error: summary }, 'kiotviet_ingress_rejected');
        // A 5xx makes KiotViet retry; the body never echoes the error.
        return reply.code(status).send({ error: status >= 500 ? 'internal' : 'rejected' });
      });

      scope.setNotFoundHandler((req, reply) => {
        req.log.info({ method: req.method, url: redactUrl(req.url) }, 'route_not_found');
        return reply.code(404).send({ error: 'not found' });
      });

      scope.post<{ Params: { token: string }; Body: string | undefined }>(
        '/:token',
        { bodyLimit: KIOTVIET_BODY_LIMIT },
        async (req, reply) => {
          const token = req.params.token;
          if (!TOKEN_RE.test(token)) return reply.code(410).send({ error: 'gone' });
          const body = typeof req.body === 'string' ? req.body : '';
          const header = req.headers['x-hub-signature'];
          const signature = (Array.isArray(header) ? header[0] : header) || null;
          const result = await store.store(token, {
            deliveryId: deliveryIdOf(body),
            body,
            signature,
          });
          if (result === 'unknown') return reply.code(410).send({ error: 'gone' });
          return reply.code(200).send({ ok: true });
        },
      );
    },
    { prefix: '/webhooks/kiotviet' },
  );
}

function statusOf(err: unknown): number {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' && code >= 400 && code < 600 ? code : 500;
}

/**
 * Error class plus Fastify / Postgres codes only. Never the message: a DrizzleQueryError
 * message is "Failed query: <sql>\nparams: <params>" and would carry the token and the body.
 */
export function safeErrorSummary(err: unknown): { name: string; code?: string; pgCode?: string } {
  const e = err as { name?: unknown; code?: unknown; cause?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : 'Error';
  const code = typeof e?.code === 'string' ? e.code : undefined;
  const cause = e?.cause as { code?: unknown } | undefined;
  const pgCode = typeof cause?.code === 'string' ? cause.code : undefined;
  return { name, ...(code ? { code } : {}), ...(pgCode ? { pgCode } : {}) };
}

/** KiotViet's `Id` (string or number) when usable, else the sha256 hex of the body. */
export function deliveryIdOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const id = (parsed as Record<string, unknown>)['Id'];
      const text =
        typeof id === 'string'
          ? id
          : typeof id === 'number' && Number.isFinite(id)
            ? String(id)
            : '';
      if (text.length > 0 && text.length <= MAX_DELIVERY_ID) return text;
    }
  } catch {
    // Malformed JSON is stored anyway; the worker drops it.
  }
  return createHash('sha256').update(body).digest('hex');
}

/** The path token is a credential: keep it out of request logs (rule 07). */
export function redactUrl(url: string): string {
  return url.replace(/^(\/webhooks\/kiotviet\/)[^/?#]+/, '$1[redacted]');
}
