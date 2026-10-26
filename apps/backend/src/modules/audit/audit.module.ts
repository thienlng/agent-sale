import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { AUDIT_FACADE } from './api/audit.facade.js';
import { AuditService } from './application/audit.service.js';
import { AUDIT_STORE } from './application/ports/audit-store.js';
import { DrizzleAuditStore } from './infrastructure/persistence/audit.drizzle-store.js';
import { UnavailableAuditStore } from './infrastructure/persistence/unavailable-store.js';
import { AuditController } from './interface/http/audit.controller.js';

/** The audit trail of workspace and security changes (T-054). Needs a database. */
@Module({
  imports: [WorkspaceModule],
  controllers: [AuditController],
  providers: [
    {
      provide: AUDIT_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleAuditStore(db) : new UnavailableAuditStore(),
    },
    AuditService,
    { provide: AUDIT_FACADE, useExisting: AuditService },
  ],
  exports: [AUDIT_FACADE],
})
export class AuditModule {}
