import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { AccountModule } from '../account/account.module.js';
import { AiModule } from '../ai/ai.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { ASSISTANT_FACADE } from './api/assistant.facade.js';
import { AssistantFacadeImpl } from './application/assistant.facade.impl.js';
import { ChatTurnService } from './application/chat-turn.service.js';
import { ASSISTANT_REPOSITORY } from './domain/ports/assistant.repository.js';
import { DrizzleAssistantRepository } from './infrastructure/persistence/assistant.drizzle-repository.js';
import { InMemoryAssistantRepository } from './infrastructure/persistence/assistant.in-memory-repository.js';
import { AssistantController } from './interface/http/assistant.controller.js';

/**
 * Owner assistant (ADR-022): account-scoped threads of one owner. With a database the
 * repository is Drizzle-backed (`withAccount`); otherwise in-memory. Exports ONLY what api/
 * declares. `AiModule` provides the LLM gateway `ChatTurnService` runs chat turns on.
 */
@Module({
  imports: [AccountModule, WorkspaceModule, AiModule],
  controllers: [AssistantController],
  providers: [
    {
      provide: ASSISTANT_REPOSITORY,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleAssistantRepository(db) : new InMemoryAssistantRepository(),
    },
    ChatTurnService,
    { provide: ASSISTANT_FACADE, useClass: AssistantFacadeImpl },
  ],
  exports: [ASSISTANT_FACADE],
})
export class AssistantModule {}
