import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureEnv } from '../common/config.js';
import { DbModule } from '../common/db/db.module.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';
import { ANALYTICS_RUNNER, type AnalyticsRunner } from '../modules/analytics/api/index.js';
import { AnalyticsModule } from '../modules/analytics/analytics.module.js';
import {
  ASSISTANT_RUNNER,
  ASSISTANT_SCHEDULE_RUNNER,
  type AssistantRunner,
  type AssistantScheduleRunner,
} from '../modules/assistant/api/index.js';
import { AssistantModule } from '../modules/assistant/assistant.module.js';
import { BILLING_RUNNER, type BillingRunner } from '../modules/billing/api/index.js';
import { BillingModule } from '../modules/billing/billing.module.js';
import { CRM_TASK_RUNNER, type CrmTaskRunner } from '../modules/crm/api/index.js';
import { CrmModule } from '../modules/crm/crm.module.js';
import { BRAIN_RUNNER, type BrainRunner } from '../modules/brain/api/index.js';
import { BrainModule } from '../modules/brain/brain.module.js';
import { CARE_RUNNER, type CareRunner } from '../modules/care/api/index.js';
import { CareModule } from '../modules/care/care.module.js';
import { DEVELOPER_RUNNER, type DeveloperRunner } from '../modules/developer/api/index.js';
import { DeveloperModule } from '../modules/developer/developer.module.js';
import { DATAEXPORT_RUNNER, type DataExportRunner } from '../modules/dataexport/api/index.js';
import { DataexportModule } from '../modules/dataexport/dataexport.module.js';
import { INTEGRATION_RUNNER, type IntegrationRunner } from '../modules/integration/api/index.js';
import { IntegrationModule } from '../modules/integration/integration.module.js';
import { NOTIFICATION_RUNNER, type NotificationRunner } from '../modules/notification/api/index.js';
import { NotificationModule } from '../modules/notification/notification.module.js';
import { SAAS_RUNNER, type SaasRunner } from '../modules/saas/api/index.js';
import { SaasModule } from '../modules/saas/saas.module.js';
import {
  WORKSPACE_PURGE_RUNNER,
  type WorkspacePurgeRunner,
} from '../modules/workspace/api/index.js';
import { WorkspaceModule } from '../modules/workspace/workspace.module.js';

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
    NotificationModule,
    AssistantModule,
    DataexportModule,
    CrmModule,
    BrainModule,
    CareModule,
    WorkspaceModule,
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
// Whole-workspace data exports (SET-10): expire old files, build one queued export per tick.
const dataExports = ctx.get<DataExportRunner>(DATAEXPORT_RUNNER);
let exportsBusy = false;
const exportTimer = setInterval(() => {
  if (exportsBusy) return;
  exportsBusy = true;
  void dataExports
    .tick()
    .catch(() => logger.error('Data export tick failed'))
    .finally(() => {
      exportsBusy = false;
    });
}, 10_000);
// Business deletion (ADR-032): purge businesses whose 30-day restore window ended; the runner
// scans once every 5 minutes.
const purge = ctx.get<WorkspacePurgeRunner>(WORKSPACE_PURGE_RUNNER);
let purging = false;
const purgeTimer = setInterval(() => {
  if (purging) return;
  purging = true;
  void purge
    .tick()
    .catch(() => logger.error('Business purge tick failed'))
    .finally(() => {
      purging = false;
    });
}, 60_000);
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
// Notification deliveries (T-172): email through Resend with retries; one tick at a time.
const notifications = ctx.get<NotificationRunner>(NOTIFICATION_RUNNER);
let notifying = false;
const notificationTimer = setInterval(() => {
  if (notifying) return;
  notifying = true;
  void notifications
    .tick()
    .catch(() => logger.error('Notification delivery tick failed'))
    .finally(() => {
      notifying = false;
    });
}, 5000);
// Owner assistant schedules (T-172): due reports and alerts; one tick at a time.
const schedules = ctx.get<AssistantScheduleRunner>(ASSISTANT_SCHEDULE_RUNNER);
let scheduling = false;
const scheduleTimer = setInterval(() => {
  if (scheduling) return;
  scheduling = true;
  void schedules
    .tick()
    .catch(() => logger.error('Assistant schedule tick failed'))
    .finally(() => {
      scheduling = false;
    });
}, 15_000);
// Due-task reminders (CRM-04): one in-app + push notice per task when its due time passes.
const crmTasks = ctx.get<CrmTaskRunner>(CRM_TASK_RUNNER);
let remindingTasks = false;
const taskTimer = setInterval(() => {
  if (remindingTasks) return;
  remindingTasks = true;
  void crmTasks
    .tick()
    .catch(() => logger.error('Task reminder tick failed'))
    .finally(() => {
      remindingTasks = false;
    });
}, 30_000);
// Business Brain (spec 2026-11-11): schedule idle evaluations from the outbox, run the due ones.
const brain = ctx.get<BrainRunner>(BRAIN_RUNNER);
let brainBusy = false;
const brainTimer = setInterval(() => {
  if (brainBusy) return;
  brainBusy = true;
  void brain
    .tick()
    .catch(() => logger.error('Brain signals tick failed'))
    .finally(() => {
      brainBusy = false;
    });
}, 15_000);
// Care agent (ADR-031): cycles from the outbox, draft expiry, then the due follow-up steps.
const care = ctx.get<CareRunner>(CARE_RUNNER);
let careBusy = false;
const careTimer = setInterval(() => {
  if (careBusy) return;
  careBusy = true;
  void care
    .tick()
    .catch(() => logger.error('Care tick failed'))
    .finally(() => {
      careBusy = false;
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
    clearInterval(notificationTimer);
    clearInterval(scheduleTimer);
    clearInterval(exportTimer);
    clearInterval(taskTimer);
    clearInterval(brainTimer);
    clearInterval(careTimer);
    clearInterval(purgeTimer);
  });
logger.info(
  { queues },
  'worker started (analytics projection, PMS sync, billing lifecycle, HQ sync, webhooks, notifications, assistant jobs, assistant schedules, task reminders, brain signals, care agent, business purge; no queue processors registered yet)',
);
