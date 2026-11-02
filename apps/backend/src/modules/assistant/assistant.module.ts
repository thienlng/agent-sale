import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { AccountModule } from '../account/account.module.js';
import { AiModule } from '../ai/ai.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { ASSISTANT_FACADE } from './api/assistant.facade.js';
import { AssistantFacadeImpl } from './application/assistant.facade.impl.js';
import { ChatTurnService } from './application/chat-turn.service.js';
import { CompactionService } from './application/compaction.service.js';
import { ImportBatchService } from './application/import-batch.service.js';
import { ProposalService } from './application/proposals.service.js';
import { SkillCatalog } from './application/skill-catalog.js';
import { SkillsService } from './application/skills.service.js';
import { ThreadPromptService } from './application/thread-prompt.service.js';
import { ASSISTANT_REPOSITORY } from './domain/ports/assistant.repository.js';
import { ROUTE_INVOKER } from './domain/ports/route-invoker.port.js';
import { FastifyRouteInvoker } from './infrastructure/http/fastify-route-invoker.js';
import { DrizzleAssistantRepository } from './infrastructure/persistence/assistant.drizzle-repository.js';
import { InMemoryAssistantRepository } from './infrastructure/persistence/assistant.in-memory-repository.js';
import { AssistantController } from './interface/http/assistant.controller.js';

/**
 * Owner assistant (ADR-023): account-scoped threads of one owner. With a database the
 * repository is Drizzle-backed (`withAccount`); otherwise in-memory. Exports ONLY what api/
 * declares. `AiModule` provides the LLM gateway `ChatTurnService` runs chat turns on.
 */
@Module({
  imports: [AccountModule, WorkspaceModule, AiModule],
  controllers: [AssistantController],
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
    ThreadPromptService,
    CompactionService,
    ChatTurnService,
    ProposalService,
    ImportBatchService,
    { provide: ASSISTANT_FACADE, useClass: AssistantFacadeImpl },
  ],
  exports: [ASSISTANT_FACADE],
})
export class AssistantModule {}
