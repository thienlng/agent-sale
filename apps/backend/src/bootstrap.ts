import 'reflect-metadata';

import { type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from 'pino';

import { type Env, loadEnv } from './common/config.js';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { createLogger, PinoNestLogger } from './common/logger.js';

export interface BootedApp {
  app: NestFastifyApplication;
  env: Env;
  logger: Logger;
}

/** Shared HTTP bootstrap used by the api entry and by HTTP-level tests. */
export async function createHttpApp(
  rootModule: Type<unknown>,
  envSource?: NodeJS.ProcessEnv,
): Promise<BootedApp> {
  const env = loadEnv(envSource);
  const logger = createLogger(env.LOG_LEVEL);
  const app = await NestFactory.create<NestFastifyApplication>(
    rootModule,
    new FastifyAdapter({ trustProxy: true }),
    {
      logger: new PinoNestLogger(logger),
      bufferLogs: true,
    },
  );
  app.setGlobalPrefix('api/v1');
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
