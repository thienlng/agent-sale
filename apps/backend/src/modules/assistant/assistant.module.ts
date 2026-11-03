import type { AssistantSqlClient, Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_ASSISTANT_SQL, DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { AccountModule } from '../account/account.module.js';
import { AiModule } from '../ai/ai.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { LodgingModule } from '../lodging/lodging.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { ASSISTANT_FACADE } from './api/assistant.facade.js';
import { ASSISTANT_RUNNER, ASSISTANT_SCHEDULE_RUNNER } from './api/assistant.runner.js';
import { AssistantJobRunner } from './application/assistant-runner.js';
import { AssistantFacadeImpl } from './application/assistant.facade.impl.js';
import { ChatTurnService } from './application/chat-turn.service.js';
import { CompactionService } from './application/compaction.service.js';
import { CuratorService } from './application/curator.service.js';
import { ImportBatchService } from './application/import-batch.service.js';
import { ProposalService } from './application/proposals.service.js';
import { ReviewService } from './application/review.service.js';
import { AssistantSettingsService } from './application/settings.service.js';
import { ReportService } from './application/report.service.js';
import { ScheduleRunner } from './application/schedule-runner.js';
import { SchedulesService } from './application/schedules.service.js';
import { SkillCatalog } from './application/skill-catalog.js';
import { SkillsService } from './application/skills.service.js';
import { SuggestionsService } from './application/suggestions.service.js';
import { ThreadPromptService } from './application/thread-prompt.service.js';
import { ASSISTANT_REPOSITORY } from './domain/ports/assistant.repository.js';
import { REPORT_DATA_SOURCE, REPORT_STRINGS } from './domain/ports/report-data-source.port.js';
import { ROUTE_INVOKER } from './domain/ports/route-invoker.port.js';
import { ASSISTANT_SQL_RUNNER } from './domain/ports/sql-runner.port.js';
import { FastifyRouteInvoker } from './infrastructure/http/fastify-route-invoker.js';
import { DrizzleAssistantRepository } from './infrastructure/persistence/assistant.drizzle-repository.js';
import { InMemoryAssistantRepository } from './infrastructure/persistence/assistant.in-memory-repository.js';
import { PostgresSqlRunner } from './infrastructure/sql/postgres-sql-runner.js';
import { AssistantSettingsController } from './interface/http/assistant-settings.controller.js';
import { FacadeReportDataSource } from './infrastructure/reports/facade-report-data-source.js';
import { i18nReportStrings } from './infrastructure/reports/report-strings.js';
import { AssistantController } from './interface/http/assistant.controller.js';
import { SchedulesController } from './interface/http/schedules.controller.js';

/**
 * Owner assistant (ADR-023): account-scoped threads of one owner. With a database the
 * repository is Drizzle-backed (`withAccount`); otherwise in-memory. Exports ONLY what api/
 * declares. `AiModule` provides the LLM gateway `ChatTurnService` runs chat turns on and the
 * worker's review runs on; the worker needs both `DB_TENANT` and `DB_SYSTEM` (job claims).
 * `commerce`, `conversation`, `crm` and `lodging` (a hotel's stays) give scheduled reports their
 * figures and `notification` delivers them.
 */
@Module({
  imports: [
    AccountModule,
    WorkspaceModule,
    AiModule,
    // Scheduled reports read figures through these facades (S3-R1) and deliver through notification.
    CommerceModule,
    ConversationModule,
    CrmModule,
    LodgingModule,
    NotificationModule,
  ],
  controllers: [AssistantController, AssistantSettingsController, SchedulesController],
  providers: [
    {
      provide: ASSISTANT_REPOSITORY,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
      ],
      // The system connection serves only the worker's cross-account job claim and curator scan.
      useFactory: (db: Database | null | undefined, system: Database | null | undefined) =>
        db ? new DrizzleAssistantRepository(db, system ?? null) : new InMemoryAssistantRepository(),
    },
    // Platform skills are parsed and linted once at boot; a bad SKILL.md fails the start.
    { provide: SkillCatalog, useFactory: () => SkillCatalog.load() },
    // Route tools and approved proposals run in process through Fastify inject (spec §6).
    { provide: ROUTE_INVOKER, useClass: FastifyRouteInvoker },
    SkillsService,
    // The read-only SQL lane (T-171); null without DATABASE_ASSISTANT_SQL_URL, and then the SQL
    // tools are not in the catalog.
    {
      provide: ASSISTANT_SQL_RUNNER,
      inject: [{ token: DB_ASSISTANT_SQL, optional: true }],
      useFactory: (client: AssistantSqlClient | null | undefined) =>
        client ? new PostgresSqlRunner(client) : null,
    },
    ThreadPromptService,
    CompactionService,
    ChatTurnService,
    ProposalService,
    ReviewService,
    CuratorService,
    AssistantSettingsService,
    SuggestionsService,
    AssistantJobRunner,
    ImportBatchService,
    { provide: REPORT_DATA_SOURCE, useClass: FacadeReportDataSource },
    { provide: REPORT_STRINGS, useValue: i18nReportStrings },
    ReportService,
    SchedulesService,
    { provide: ASSISTANT_FACADE, useClass: AssistantFacadeImpl },
    // The worker ticks it: the background review and the daily curator, ruling 1c-R1.
    { provide: ASSISTANT_RUNNER, useExisting: AssistantJobRunner },
    // The worker runs due schedules (T-172); the api process never ticks it.
    { provide: ASSISTANT_SCHEDULE_RUNNER, useClass: ScheduleRunner },
  ],
  exports: [ASSISTANT_FACADE, ASSISTANT_RUNNER, ASSISTANT_SCHEDULE_RUNNER],
})
export class AssistantModule {}
