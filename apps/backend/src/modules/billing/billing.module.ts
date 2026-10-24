import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { BILLING_FACADE } from './api/billing.facade.js';
import { BillingService } from './application/billing.service.js';
import { BILLING_STORE } from './application/ports/billing-store.js';
import { DrizzleBillingStore } from './infrastructure/persistence/billing.drizzle-store.js';
import { UnavailableBillingStore } from './infrastructure/persistence/unavailable-store.js';
import { BillingController } from './interface/http/billing.controller.js';

/** Plans, subscriptions and entitlements (docs/08). Needs a database. */
@Module({
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
    BillingService,
    { provide: BILLING_FACADE, useExisting: BillingService },
  ],
  exports: [BILLING_FACADE],
})
export class BillingModule {}
