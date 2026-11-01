import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { type INestApplication, RequestMethod, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { RawRequestDefaultExpression } from 'fastify';
import type { Logger } from 'pino';

import { configureEnv, type Env } from './common/config.js';
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
    trustProxy: true,
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
  // Parsed only where a handler calls `req.file()` (the widget's image upload); no other route reads multipart.
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
