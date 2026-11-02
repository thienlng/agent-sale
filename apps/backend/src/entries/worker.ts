import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureEnv } from '../common/config.js';
import { DbModule } from '../common/db/db.module.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';
import { ANALYTICS_RUNNER, type AnalyticsRunner } from '../modules/analytics/api/index.js';
import { ASSISTANT_RUNNER, type AssistantRunner } from '../modules/assistant/api/index.js';
import { AssistantModule } from '../modules/assistant/assistant.module.js';
import { AnalyticsModule } from '../modules/analytics/analytics.module.js';
import { BILLING_RUNNER, type BillingRunner } from '../modules/billing/api/index.js';
import { BillingModule } from '../modules/billing/billing.module.js';
import { DEVELOPER_RUNNER, type DeveloperRunner } from '../modules/developer/api/index.js';
import { DeveloperModule } from '../modules/developer/developer.module.js';
import { INTEGRATION_RUNNER, type IntegrationRunner } from '../modules/integration/api/index.js';
import { IntegrationModule } from '../modules/integration/integration.module.js';
import { SAAS_RUNNER, type SaasRunner } from '../modules/saas/api/index.js';
import { SaasModule } from '../modules/saas/saas.module.js';

/**
 * Worker entry: boots an application context (no HTTP) and registers the
 * BullMQ processors of the queue groups listed in WORKER_QUEUES
 * (outbound, campaign, workflow, indexer, scheduler). Processors live in each
 * module's application/jobs and are wired here as modules land.
 */
@Module({
  imports: [
    DbModule,
    AnalyticsModule,
    IntegrationModule,
    BillingModule,
    SaasModule,
    DeveloperModule,
    AssistantModule,
  ],
})
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
// Rapiz HQ sync (no-op unless RAPIZ_HQ_WORKSPACE_ID is set), and the saas daily jobs (reminders,
// nightly HQ reconcile), each claimed once per day across workers.
const saas = ctx.get<SaasRunner>(SAAS_RUNNER);
let hqSyncing = false;
const hqTimer = setInterval(() => {
  if (hqSyncing) return;
  hqSyncing = true;
  void saas
    .tick()
    .catch(() => logger.error('HQ sync tick failed'))
    .finally(() => {
      hqSyncing = false;
    });
}, 2000);
// Outbound webhooks (ADR-022): dispatch new public events, send due deliveries with retries.
const developer = ctx.get<DeveloperRunner>(DEVELOPER_RUNNER);
let webhooksBusy = false;
const webhookTimer = setInterval(() => {
  if (webhooksBusy) return;
  webhooksBusy = true;
  void developer
    .tick()
    .catch(() => logger.error('Webhook delivery tick failed'))
    .finally(() => {
      webhooksBusy = false;
    });
}, 2000);
// Owner assistant background jobs (the review): Postgres-leased, up to 3 per tick (ruling 1c-R1).
const assistant = ctx.get<AssistantRunner>(ASSISTANT_RUNNER);
let assistantBusy = false;
const assistantTimer = setInterval(() => {
  if (assistantBusy) return;
  assistantBusy = true;
  void assistant
    .tick()
    .catch(() => logger.error('Assistant jobs tick failed'))
    .finally(() => {
      assistantBusy = false;
    });
}, 15_000);
let dailyRunning = false;
const runDaily = () => {
  if (dailyRunning) return;
  dailyRunning = true;
  void saas
    .daily()
    .catch(() => logger.error('SaaS daily jobs failed'))
    .finally(() => {
      dailyRunning = false;
    });
};
const dailyTimer = setInterval(runDaily, 15 * 60_000);
runDaily();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  // The intervals keep the worker alive; clearing them lets the process drain and exit.
  process.once(signal, () => {
    clearInterval(timer);
    clearInterval(syncTimer);
    clearInterval(billingTimer);
    clearInterval(hqTimer);
    clearInterval(dailyTimer);
    clearInterval(webhookTimer);
    clearInterval(assistantTimer);
  });
logger.info(
  { queues },
  'worker started (analytics projection, PMS sync, billing lifecycle, HQ sync, webhooks, assistant jobs; no queue processors registered yet)',
);
