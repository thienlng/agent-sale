import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { WORKSPACE_FACADE } from './api/workspace.facade.js';
import { CreateWorkspaceHandler } from './application/commands/create-workspace/create-workspace.handler.js';
import { ManageMembersHandler } from './application/commands/manage-members/manage-members.handler.js';
import { WORKSPACE_DIRECTORY } from './application/ports/workspace-directory.js';
import { WORKSPACE_UOW } from './application/ports/workspace-unit-of-work.js';
import { GetWorkspaceHandler } from './application/queries/get-workspace/get-workspace.handler.js';
import { WorkspaceFacadeImpl } from './application/workspace.facade.impl.js';
import {
  DrizzleWorkspaceDirectory,
  InMemoryWorkspaceDirectory,
} from './infrastructure/workspace.directory.js';
import {
  DrizzleWorkspaceUnitOfWork,
  InMemoryWorkspaceUnitOfWork,
} from './infrastructure/workspace.unit-of-work.js';
import { WorkspaceController } from './interface/http/workspace.controller.js';

const MEMORY_STORE = Symbol('WORKSPACE_MEMORY_STORE');

/**
 * Ports are bound by token. With databases configured the adapters are
 * Drizzle-backed (tenant UoW + system directory); otherwise in-memory sharing
 * one store. Exports ONLY what api/ declares.
 */
@Module({
  controllers: [WorkspaceController],
  providers: [
    CreateWorkspaceHandler,
    GetWorkspaceHandler,
    ManageMembersHandler,
    { provide: MEMORY_STORE, useFactory: () => new InMemoryWorkspaceUnitOfWork() },
    {
      provide: WORKSPACE_UOW,
      inject: [{ token: DB_TENANT, optional: true }, MEMORY_STORE],
      useFactory: (db: Database | null | undefined, mem: InMemoryWorkspaceUnitOfWork) =>
        db ? new DrizzleWorkspaceUnitOfWork(db) : mem,
    },
    {
      provide: WORKSPACE_DIRECTORY,
      inject: [{ token: DB_SYSTEM, optional: true }, MEMORY_STORE],
      useFactory: (db: Database | null | undefined, mem: InMemoryWorkspaceUnitOfWork) =>
        db ? new DrizzleWorkspaceDirectory(db) : new InMemoryWorkspaceDirectory(mem),
    },
    { provide: WORKSPACE_FACADE, useClass: WorkspaceFacadeImpl },
  ],
  exports: [WORKSPACE_FACADE],
})
export class WorkspaceModule {}
