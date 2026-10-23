import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { WORKSPACE_FACADE } from './api/workspace.facade.js';
import { CreateWorkspaceHandler } from './application/commands/create-workspace/create-workspace.handler.js';
import { WORKSPACE_UOW } from './application/ports/workspace-unit-of-work.js';
import { GetWorkspaceHandler } from './application/queries/get-workspace/get-workspace.handler.js';
import { WorkspaceFacadeImpl } from './application/workspace.facade.impl.js';
import {
  DrizzleWorkspaceUnitOfWork,
  InMemoryWorkspaceUnitOfWork,
} from './infrastructure/workspace.unit-of-work.js';
import { WorkspaceController } from './interface/http/workspace.controller.js';

/**
 * Ports are bound by token. With a database configured the unit of work is
 * Drizzle-backed (withTenant + outbox); otherwise in-memory.
 * Exports ONLY what api/ declares.
 */
@Module({
  controllers: [WorkspaceController],
  providers: [
    CreateWorkspaceHandler,
    GetWorkspaceHandler,
    {
      provide: WORKSPACE_UOW,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleWorkspaceUnitOfWork(db) : new InMemoryWorkspaceUnitOfWork(),
    },
    { provide: WORKSPACE_FACADE, useClass: WorkspaceFacadeImpl },
  ],
  exports: [WORKSPACE_FACADE],
})
export class WorkspaceModule {}
