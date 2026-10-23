import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import { httpRequestDuration } from '../metrics.js';

/**
 * Per-request observability on the Fastify instance:
 * - echoes the request id (X-Request-Id in → same id out; generated otherwise),
 * - one structured access-log line per request,
 * - latency histogram by route template (docs/16 §2 budgets are measured from it).
 */
export function installHttpObservability(fastify: FastifyInstance, logger: Logger): void {
  fastify.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });
  fastify.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const seconds = reply.elapsedTime / 1000;
    httpRequestDuration.observe(
      { method: request.method, route, status: String(reply.statusCode) },
      seconds,
    );
    if (route === '/metrics') return;
    logger.info(
      {
        reqId: request.id,
        method: request.method,
        route,
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'http request',
    );
  });
}
