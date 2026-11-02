import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM } from '../../common/db/db.module.js';
import { AccountModule } from '../account/account.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { BACKOFFICE_FACADE } from './api/backoffice.facade.js';
import { BackofficeFacadeImpl } from './application/backoffice.facade.impl.js';
import { PLATFORM_AUDIT_STORE } from './application/ports/platform-audit-store.js';
import { DrizzlePlatformAuditStore } from './infrastructure/persistence/platform-audit.drizzle-store.js';
import { UnavailablePlatformAuditStore } from './infrastructure/persistence/unavailable-store.js';
import { AccountsController } from './interface/http/accounts.controller.js';
import { PaymentsController } from './interface/http/payments.controller.js';
import { PlansController } from './interface/http/plans.controller.js';

/**
 * Tier 3: the platform admin's HTTP surface (ADR-021 §6). Reads join the tier-1 facades; writes go
 * to the owning module's facade. Owns no tables; reads `platform_audit_events` (appended by others).
 */
@Module({
  imports: [AccountModule, WorkspaceModule, IdentityModule, BillingModule],
  controllers: [PlansController, AccountsController, PaymentsController],
  providers: [
    {
      provide: PLATFORM_AUDIT_STORE,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzlePlatformAuditStore(db) : new UnavailablePlatformAuditStore(),
    },
    { provide: BACKOFFICE_FACADE, useClass: BackofficeFacadeImpl },
  ],
  exports: [BACKOFFICE_FACADE],
})
export class BackofficeModule {}
