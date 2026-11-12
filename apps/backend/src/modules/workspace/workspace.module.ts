import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { getEnv } from '../../common/config.js';
import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { AccountModule } from '../account/account.module.js';
import { WORKSPACE_EXPORT } from './api/workspace-export.js';
import { WORKSPACE_FACADE } from './api/workspace.facade.js';
import { WORKSPACE_LIFECYCLE, WorkspaceLifecycle } from './api/workspace-lifecycle.js';
import { WORKSPACE_PURGE_RUNNER } from './api/workspace-purge.runner.js';
import { BusinessDeletionService } from './application/business-deletion.service.js';
import {
  BUSINESS_OBJECT_ERASER,
  WORKSPACE_PURGE_STORE,
} from './application/ports/workspace-purge.js';
import { WorkspacePurgeRunnerImpl } from './application/workspace-purge.runner.js';
import {
  DrizzleWorkspacePurgeStore,
  NoopWorkspacePurgeStore,
} from './infrastructure/persistence/workspace-purge.drizzle-store.js';
import { S3BusinessObjectEraser } from './infrastructure/storage/s3-business-object-eraser.js';
import { CreateWorkspaceHandler } from './application/commands/create-workspace/create-workspace.handler.js';
import { ManageMembersHandler } from './application/commands/manage-members/manage-members.handler.js';
import { WORKSPACE_DIRECTORY } from './application/ports/workspace-directory.js';
import { WORKSPACE_UOW } from './application/ports/workspace-unit-of-work.js';
import { GetWorkspaceHandler } from './application/queries/get-workspace/get-workspace.handler.js';
import { WorkspaceFacadeImpl } from './application/workspace.facade.impl.js';
import { WorkspaceDataExportSource } from './infrastructure/export/workspace.export.js';
import {
  DrizzleWorkspaceDirectory,
  InMemoryWorkspaceDirectory,
} from './infrastructure/workspace.directory.js';
import {
  DrizzleWorkspaceUnitOfWork,
  InMemoryWorkspaceUnitOfWork,
} from './infrastructure/workspace.unit-of-work.js';
import { ProfileController } from './interface/http/profile.controller.js';
import { WorkspaceController } from './interface/http/workspace.controller.js';
import { ProfileService } from './application/profile.service.js';

const MEMORY_STORE = Symbol('WORKSPACE_MEMORY_STORE');

/**
 * Ports are bound by token. With databases configured the adapters are
 * Drizzle-backed (tenant UoW + system directory); otherwise in-memory sharing
 * one store. Exports ONLY what api/ declares.
 */
@Module({
  imports: [AccountModule],
  controllers: [WorkspaceController, ProfileController],
  providers: [
    CreateWorkspaceHandler,
    GetWorkspaceHandler,
    ManageMembersHandler,
    ProfileService,
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
    { provide: WORKSPACE_LIFECYCLE, useValue: new WorkspaceLifecycle() },
    BusinessDeletionService,
    {
      provide: WORKSPACE_PURGE_STORE,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleWorkspacePurgeStore(db) : new NoopWorkspacePurgeStore(),
    },
    {
      provide: BUSINESS_OBJECT_ERASER,
      useFactory: () => {
        const env = getEnv();
        return new S3BusinessObjectEraser({
          endpoint: env.S3_ENDPOINT,
          mediaBucket: env.S3_BUCKET,
          exportBucket: env.S3_EXPORT_BUCKET,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
        });
      },
    },
    { provide: WORKSPACE_PURGE_RUNNER, useClass: WorkspacePurgeRunnerImpl },
    {
      provide: WORKSPACE_EXPORT,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) => new WorkspaceDataExportSource(db ?? null),
    },
  ],
  exports: [WORKSPACE_FACADE, WORKSPACE_EXPORT, WORKSPACE_LIFECYCLE, WORKSPACE_PURGE_RUNNER],
})
export class WorkspaceModule {}
