import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import { parseTrustProxy } from '@agent-sales/shared';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { type INestApplication, RequestMethod, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { RawRequestDefaultExpression, RawServerDefault } from 'fastify';
import type { Logger } from 'pino';

import { configureEnv, type Env } from './common/config.js';
import { ApiError } from './common/http/api-error.js';
import { API_PREFIX } from './common/http/api-prefix.js';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { installHttpObservability } from './common/http/observability.js';
import { createLogger, PinoNestLogger } from './common/logger.js';

export interface BootedApp {
  app: NestFastifyApplication;
  env: Env;
  logger: Logger;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Shared HTTP bootstrap used by the api entry and by HTTP-level tests. */
export async function createHttpApp(
  rootModule: Type<unknown>,
  envSource?: NodeJS.ProcessEnv,
): Promise<BootedApp> {
  const env = configureEnv(envSource ?? process.env);
  const logger = createLogger(env.LOG_LEVEL);
  const adapter = new FastifyAdapter({
    // Only the deploy's own proxy hops (TRUST_PROXY): `req.ip` feeds every per-IP limit, so a
    // client-written X-Forwarded-For must never become it.
    trustProxy: parseTrustProxy(env.TRUST_PROXY, env.NODE_ENV, isIP),
    // Accept a well-formed upstream X-Request-Id (CDN/LB), otherwise generate one.
    genReqId: (req: RawRequestDefaultExpression) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });
  installHttpObservability(adapter.getInstance(), logger);
  // Nest's @RouteConfig({ bodyLimit }) lands under the route `config` key, but Fastify reads the limit
  // from the top-level route option, so copy it; routes without it keep the global default.
  adapter.getInstance().addHook('onRoute', (route) => {
    const limit = (route.config as { bodyLimit?: unknown } | undefined)?.bodyLimit;
    if (typeof limit === 'number') route.bodyLimit = limit;
  });
  const app = await NestFactory.create<NestFastifyApplication>(rootModule, adapter, {
    logger: new PinoNestLogger(logger),
    bufferLogs: true,
  });
  await app.register(fastifyCookie);
  // Parsed only where a handler calls `req.file()` (widget image upload, lodging video upload); each call sets its own fileSize.
  await app.register(fastifyMultipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  });
  // Logo uploads are raw image bodies, read as a Buffer for these two types only. The limit is a little
  // above the 1 MiB rule so an oversized file gets the precise error from the service, not a bare 413.
  adapter
    .getInstance()
    .addContentTypeParser(
      ['image/png', 'image/jpeg'],
      { parseAs: 'buffer', bodyLimit: 1_200_000 },
      (_req, body, done) => {
        done(null, body);
      },
    );
  // A DELETE carries no body, yet some clients still send `content-type: application/json` with it;
  // Fastify's JSON parser rejects that empty body, so accept it as "no body" on DELETE only. Every
  // other empty or malformed JSON body still fails and the filter answers 400 (docs/11 §2).
  const fastify = adapter.getInstance();
  const parseJson = fastify.getDefaultJsonParser('error', 'error');
  // No options: the parser keeps Fastify's global body limit and each route's own limit.
  app.useBodyParser<RawServerDefault>('application/json', undefined, (req, body, done) => {
    if (req.method === 'DELETE' && body.length === 0) {
      done(null, undefined);
      return;
    }
    // Fastify's own error loses its code once Nest maps it, so answer with the envelope's reason.
    parseJson(req, body.toString('utf8'), (err, parsed) => {
      if (!err) return done(null, parsed);
      const empty = (err as { code?: unknown }).code === 'FST_ERR_CTP_EMPTY_JSON_BODY';
      done(
        new ApiError(
          'VALIDATION_FAILED',
          empty ? 'The request body is empty' : 'The request body is not valid JSON',
          { reason: empty ? 'EMPTY_JSON_BODY' : 'INVALID_JSON_BODY' },
        ),
        undefined,
      );
    });
  });
  app.setGlobalPrefix(API_PREFIX, { exclude: [{ path: 'metrics', method: RequestMethod.GET }] });
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.enableShutdownHooks();
  return { app, env, logger };
}

export function registerShutdown(app: INestApplication, logger: Logger): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      logger.info({ signal }, 'shutting down');
      void app.close().then(() => process.exit(0));
    });
  }
}
