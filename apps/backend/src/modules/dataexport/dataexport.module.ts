import type { WorkspaceExportSource } from '@agent-sales/contracts';
import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { getEnv } from '../../common/config.js';
import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { BOT_EXPORT } from '../bot/api/index.js';
import { BRAIN_EXPORT } from '../brain/api/index.js';
import { BrainModule } from '../brain/brain.module.js';
import { BotModule } from '../bot/bot.module.js';
import { COMMERCE_EXPORT } from '../commerce/api/index.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { CONVERSATION_EXPORT } from '../conversation/api/index.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { CRM_EXPORT } from '../crm/api/index.js';
import { CrmModule } from '../crm/crm.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { KNOWLEDGE_EXPORT } from '../knowledge/api/index.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { LODGING_EXPORT } from '../lodging/api/index.js';
import { LodgingModule } from '../lodging/lodging.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { SAAS_EXPORT } from '../saas/api/index.js';
import { SaasModule } from '../saas/saas.module.js';
import { WORKSPACE_EXPORT } from '../workspace/api/index.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { DATAEXPORT_RUNNER } from './api/dataexport.runner.js';
import { DataExportRunnerImpl, EXPORT_SOURCES } from './application/data-export.runner.js';
import { DataExportService } from './application/data-export.service.js';
import { DATA_EXPORT_STORE } from './application/ports/data-export-store.js';
import { EXPORT_ARCHIVE_WRITER, EXPORT_FILE_STORAGE } from './application/ports/export-files.js';
import type { ExportFileStorage } from './application/ports/export-files.js';
import { ZipArchiveWriter } from './infrastructure/archive/zip-archive-writer.js';
import { DrizzleDataExportStore } from './infrastructure/persistence/data-export.drizzle-store.js';
import { UnavailableDataExportStore } from './infrastructure/persistence/unavailable-store.js';
import { S3ExportFileStorage } from './infrastructure/storage/s3-export-storage.js';
import {
  DataExportDownloadController,
  DataExportsController,
} from './interface/http/data-exports.controller.js';

const SOURCE_TOKENS = [
  WORKSPACE_EXPORT,
  CRM_EXPORT,
  CONVERSATION_EXPORT,
  COMMERCE_EXPORT,
  KNOWLEDGE_EXPORT,
  LODGING_EXPORT,
  BOT_EXPORT,
  SAAS_EXPORT,
  BRAIN_EXPORT,
];

/** Whole-workspace data export (SET-10): requests and downloads in the api, builds in the worker. */
@Module({
  imports: [
    IdentityModule,
    WorkspaceModule,
    NotificationModule,
    CrmModule,
    ConversationModule,
    BrainModule,
    CommerceModule,
    KnowledgeModule,
    LodgingModule,
    BotModule,
    SaasModule,
  ],
  controllers: [DataExportsController, DataExportDownloadController],
  providers: [
    {
      provide: DATA_EXPORT_STORE,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
      ],
      useFactory: (tenant: Database | null | undefined, system: Database | null | undefined) =>
        tenant && system
          ? new DrizzleDataExportStore(tenant, system)
          : new UnavailableDataExportStore(),
    },
    {
      provide: EXPORT_FILE_STORAGE,
      useFactory: () => {
        const env = getEnv();
        return new S3ExportFileStorage({
          endpoint: env.S3_ENDPOINT,
          mediaBucket: env.S3_BUCKET,
          exportBucket: env.S3_EXPORT_BUCKET,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
        });
      },
    },
    {
      provide: EXPORT_ARCHIVE_WRITER,
      inject: [EXPORT_FILE_STORAGE],
      useFactory: (files: ExportFileStorage) => new ZipArchiveWriter(files),
    },
    {
      provide: EXPORT_SOURCES,
      inject: SOURCE_TOKENS,
      useFactory: (...sources: WorkspaceExportSource[]) => sources,
    },
    DataExportService,
    { provide: DATAEXPORT_RUNNER, useClass: DataExportRunnerImpl },
  ],
  exports: [DATAEXPORT_RUNNER],
})
export class DataexportModule {}
