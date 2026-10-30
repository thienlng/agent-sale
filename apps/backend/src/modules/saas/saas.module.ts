import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { SAAS_FACADE } from './api/saas.facade.js';
import { SAAS_STORE } from './application/ports/saas-store.js';
import { SaasFacadeImpl } from './application/saas.facade.impl.js';
import { SaasLeadService } from './application/saas-lead.service.js';
import { SaasSubscriptionService } from './application/saas-subscription.service.js';
import { SaasUnavailableError } from './domain/saas.errors.js';
import { DrizzleSaasStore } from './infrastructure/persistence/saas.drizzle-store.js';
import { SaasSubscriptionsController } from './interface/http/saas.controller.js';

/** SaaS vertical (ADR-014): customer subscriptions and the bot's request capture. Needs a database. */
@Module({
  imports: [IdentityModule, WorkspaceModule, CrmModule],
  controllers: [SaasSubscriptionsController],
  providers: [
    {
      provide: SAAS_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleSaasStore(db) : { run: () => Promise.reject(new SaasUnavailableError()) },
    },
    SaasLeadService,
    SaasSubscriptionService,
    { provide: SAAS_FACADE, useClass: SaasFacadeImpl },
  ],
  exports: [SAAS_FACADE],
})
export class SaasModule {}
