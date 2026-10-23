import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { loadEnv } from '../common/config.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';

/**
 * Realtime entry: SSE streams (inbox updates, widget streaming) fed by Redis
 * pub/sub, plus a websocket-only Socket.IO surface for presence (ADR-009).
 * Separate deployment so API rollouts never drop client connections.
 */
@Module({ imports: [] })
class RealtimeModule {}

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const app = await NestFactory.create<NestFastifyApplication>(RealtimeModule, new FastifyAdapter(), {
  logger: new PinoNestLogger(logger),
});
await app.listen({ port: env.PORT, host: '0.0.0.0' });
logger.info({ port: env.PORT }, 'realtime listening (no streams registered yet)');
