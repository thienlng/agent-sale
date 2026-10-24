import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureEnv } from '../common/config.js';
import { DbModule } from '../common/db/db.module.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';
import { ANALYTICS_RUNNER, type AnalyticsRunner } from '../modules/analytics/api/index.js';
import { AnalyticsModule } from '../modules/analytics/analytics.module.js';

/**
 * Worker entry: boots an application context (no HTTP) and registers the
 * BullMQ processors of the queue groups listed in WORKER_QUEUES
 * (outbound, campaign, workflow, indexer, scheduler). Processors live in each
 * module's application/jobs and are wired here as modules land.
 */
@Module({ imports: [DbModule, AnalyticsModule] })
class WorkerModule {}

const env = configureEnv();
const logger = createLogger(env.LOG_LEVEL);
const queues = (
  process.env['WORKER_QUEUES'] ?? 'outbound,campaign,workflow,indexer,scheduler'
).split(',');
const ctx = await NestFactory.createApplicationContext(WorkerModule, {
  logger: new PinoNestLogger(logger),
});
ctx.enableShutdownHooks();
const projector = ctx.get<AnalyticsRunner>(ANALYTICS_RUNNER);
let projecting = false;
const timer = setInterval(() => {
  if (projecting) return;
  projecting = true;
  void projector
    .tick()
    .catch(() => logger.error('Analytics projection tick failed'))
    .finally(() => {
      projecting = false;
    });
}, 2000);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  // The interval keeps the worker alive; clearing it lets the process drain and exit.
  process.once(signal, () => clearInterval(timer));
logger.info(
  { queues },
  'worker started (analytics projection; no queue processors registered yet)',
);
