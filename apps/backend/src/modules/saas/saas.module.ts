import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { getEnv } from '../../common/config.js';
import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { AccountModule } from '../account/account.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { SAAS_FACADE } from './api/saas.facade.js';
import { SAAS_RUNNER } from './api/saas.runner.js';
import { HqSyncHandler } from './application/event-handlers/hq-sync.handler.js';
import { HQ_WORKSPACE, HqContext } from './application/hq-context.js';
import { HqReconcileService } from './application/hq-reconcile.service.js';
import { FacadePlatformDirectory } from './application/platform-directory.js';
import { PLATFORM_DIRECTORY } from './application/ports/platform-directory.js';
import { SAAS_STORE } from './application/ports/saas-store.js';
import { SAAS_SYSTEM_STORE } from './application/ports/saas-system-store.js';
import { SaasFacadeImpl } from './application/saas.facade.impl.js';
import { SaasLeadService } from './application/saas-lead.service.js';
import { SaasPlanService } from './application/saas-plan.service.js';
import { SaasReminderService } from './application/saas-reminder.service.js';
import { SaasRunnerImpl } from './application/saas.runner.impl.js';
import { SaasSubscriptionService } from './application/saas-subscription.service.js';
import { SaasUnavailableError } from './domain/saas.errors.js';
import { DrizzleSaasStore } from './infrastructure/persistence/saas.drizzle-store.js';
import { DrizzleSaasSystemStore } from './infrastructure/persistence/saas-system.drizzle-store.js';
import { SaasSubscriptionsController } from './interface/http/saas.controller.js';

const unavailable = () => Promise.reject(new SaasUnavailableError());

/**
 * SaaS vertical (ADR-020): customer subscriptions, the plan catalog and the bot's request capture;
 * and the Rapiz HQ sync (ADR-021) when `RAPIZ_HQ_WORKSPACE_ID` is set. Needs a database.
 */
@Module({
  imports: [AccountModule, BillingModule, IdentityModule, WorkspaceModule, CrmModule],
  controllers: [SaasSubscriptionsController],
  providers: [
    {
      provide: SAAS_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleSaasStore(db) : { run: unavailable },
    },
    {
      provide: SAAS_SYSTEM_STORE,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db
          ? new DrizzleSaasSystemStore(db)
          : {
              withHqLease: unavailable,
              claimDaily: unavailable,
              dueReminders: unavailable,
              markReminderSent: unavailable,
            },
    },
    { provide: PLATFORM_DIRECTORY, useClass: FacadePlatformDirectory },
    { provide: HQ_WORKSPACE, useFactory: () => getEnv().RAPIZ_HQ_WORKSPACE_ID ?? null },
    HqContext,
    SaasLeadService,
    SaasSubscriptionService,
    SaasPlanService,
    SaasReminderService,
    HqSyncHandler,
    HqReconcileService,
    SaasRunnerImpl,
    { provide: SAAS_FACADE, useClass: SaasFacadeImpl },
    { provide: SAAS_RUNNER, useExisting: SaasRunnerImpl },
  ],
  exports: [SAAS_FACADE, SAAS_RUNNER],
})
export class SaasModule {}
