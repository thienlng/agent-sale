import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureEnv } from '../common/config.js';
import { DbModule } from '../common/db/db.module.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';
import { ANALYTICS_RUNNER, type AnalyticsRunner } from '../modules/analytics/api/index.js';
import { AnalyticsModule } from '../modules/analytics/analytics.module.js';
import { BILLING_RUNNER, type BillingRunner } from '../modules/billing/api/index.js';
import { BillingModule } from '../modules/billing/billing.module.js';
import { INTEGRATION_RUNNER, type IntegrationRunner } from '../modules/integration/api/index.js';
import { IntegrationModule } from '../modules/integration/integration.module.js';

/**
 * Worker entry: boots an application context (no HTTP) and registers the
 * BullMQ processors of the queue groups listed in WORKER_QUEUES
 * (outbound, campaign, workflow, indexer, scheduler). Processors live in each
 * module's application/jobs and are wired here as modules land.
 */
@Module({ imports: [DbModule, AnalyticsModule, IntegrationModule, BillingModule] })
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
// PMS sync (full imports, reconciles, webhook deliveries); one tick at a time, like the projector.
const integration = ctx.get<IntegrationRunner>(INTEGRATION_RUNNER);
let syncing = false;
const syncTimer = setInterval(() => {
  if (syncing) return;
  syncing = true;
  void integration
    .tick()
    .catch(() => logger.error('Integration sync tick failed'))
    .finally(() => {
      syncing = false;
    });
}, 2000);
// Subscription lifecycle, reminders and the daily usage snapshot (ADR-021); the runner throttles
// itself to one pass every few minutes.
const billing = ctx.get<BillingRunner>(BILLING_RUNNER);
let billingBusy = false;
const billingTimer = setInterval(() => {
  if (billingBusy) return;
  billingBusy = true;
  void billing
    .tick()
    .catch(() => logger.error('Billing lifecycle tick failed'))
    .finally(() => {
      billingBusy = false;
    });
}, 2000);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  // The intervals keep the worker alive; clearing them lets the process drain and exit.
  process.once(signal, () => {
    clearInterval(timer);
    clearInterval(syncTimer);
    clearInterval(billingTimer);
  });
logger.info(
  { queues },
  'worker started (analytics projection, PMS sync, billing lifecycle; no queue processors registered yet)',
);
