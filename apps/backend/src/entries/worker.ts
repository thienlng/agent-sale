import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { loadEnv } from '../common/config.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';

/**
 * Worker entry: boots an application context (no HTTP) and registers the
 * BullMQ processors of the queue groups listed in WORKER_QUEUES
 * (outbound, campaign, workflow, indexer, scheduler). Processors live in each
 * module's application/jobs and are wired here as modules land.
 */
@Module({ imports: [] })
class WorkerModule {}

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const queues = (
  process.env['WORKER_QUEUES'] ?? 'outbound,campaign,workflow,indexer,scheduler'
).split(',');
const ctx = await NestFactory.createApplicationContext(WorkerModule, {
  logger: new PinoNestLogger(logger),
});
ctx.enableShutdownHooks();
logger.info({ queues }, 'worker started (no processors registered yet)');
