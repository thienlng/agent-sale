import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { BILLING_ADMIN_FACADE, BILLING_RUNNER } from './api/billing-admin.facade.js';
import { BILLING_FACADE } from './api/billing.facade.js';
import { BillingAdminService } from './application/billing-admin.service.js';
import { BillingCatalog } from './application/billing-catalog.js';
import { BillingService } from './application/billing.service.js';
import { BillingLifecycleRunner } from './application/jobs/billing-lifecycle.runner.js';
import { BILLING_ADMIN_STORE } from './application/ports/billing-admin-store.js';
import { BILLING_STORE } from './application/ports/billing-store.js';
import { DrizzleBillingAdminStore } from './infrastructure/persistence/billing-admin.drizzle-store.js';
import { DrizzleBillingStore } from './infrastructure/persistence/billing.drizzle-store.js';
import {
  UnavailableBillingStore,
  UnavailableBillingAdminStore,
} from './infrastructure/persistence/unavailable-store.js';
import { BillingController } from './interface/http/billing.controller.js';

/**
 * Plans, subscriptions, entitlements, the message allowance (docs/08), and the platform admin side
 * of billing: catalog, settings, payments, lifecycle (ADR-021). Needs a database.
 */
@Module({
  imports: [WorkspaceModule],
  controllers: [BillingController],
  providers: [
    {
      provide: BILLING_STORE,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
      ],
      useFactory: (tenant: Database | null | undefined, system: Database | null | undefined) =>
        tenant && system ? new DrizzleBillingStore(tenant, system) : new UnavailableBillingStore(),
    },
    {
      provide: BILLING_ADMIN_STORE,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (system: Database | null | undefined) =>
        system ? new DrizzleBillingAdminStore(system) : new UnavailableBillingAdminStore(),
    },
    BillingCatalog,
    BillingService,
    BillingAdminService,
    BillingLifecycleRunner,
    { provide: BILLING_FACADE, useExisting: BillingService },
    { provide: BILLING_ADMIN_FACADE, useExisting: BillingAdminService },
    { provide: BILLING_RUNNER, useExisting: BillingLifecycleRunner },
  ],
  exports: [BILLING_FACADE, BILLING_ADMIN_FACADE, BILLING_RUNNER],
})
export class BillingModule {}
