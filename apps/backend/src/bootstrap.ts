import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { type INestApplication, RequestMethod, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { RawRequestDefaultExpression } from 'fastify';
import type { Logger } from 'pino';

import { type Env, loadEnv } from './common/config.js';
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
  const env = loadEnv(envSource);
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
  const app = await NestFactory.create<NestFastifyApplication>(rootModule, adapter, {
    logger: new PinoNestLogger(logger),
    bufferLogs: true,
  });
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'metrics', method: RequestMethod.GET }] });
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
