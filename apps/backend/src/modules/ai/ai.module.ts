import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { getEnv, hermesSubscriptionLoginEnabled } from '../../common/config.js';
import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { SECRET_BOX, SecretBox } from '../../common/security/secret-box.js';
import { ActionModule } from '../action/action.module.js';
import { BotModule } from '../bot/bot.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { AI_FACADE } from './api/ai.facade.js';
import { HERMES_SUBSCRIPTION_LOGIN, LlmAdminService } from './application/llm-admin.service.js';
import { LlmRuntime } from './application/llm-runtime.js';
import { PlaygroundService } from './application/playground.service.js';
import { LLM_PROVIDER_FACTORY } from './application/ports/llm-provider-factory.js';
import { AI_RUN_REPOSITORY } from './domain/ports/ai-run.repository.js';
import { CONVERSATION_SUMMARY_REPOSITORY } from './domain/ports/conversation-summary.repository.js';
import { LLM_CONFIG_REPOSITORY } from './domain/ports/llm-config.repository.js';
import { SdkLlmProviderFactory } from './infrastructure/llm/sdk-provider-factory.js';
import {
  DrizzleAiRunRepository,
  InMemoryAiRunRepository,
} from './infrastructure/persistence/ai-run.repositories.js';
import {
  DrizzleConversationSummaryRepository,
  InMemoryConversationSummaryRepository,
} from './infrastructure/persistence/conversation-summary.drizzle.js';
import { DrizzleLlmConfigRepository } from './infrastructure/persistence/llm-config.drizzle-repository.js';
import { InMemoryLlmConfigRepository } from './infrastructure/persistence/llm-config.in-memory-repository.js';
import { AiController } from './interface/http/ai.controller.js';
import { LlmAdminController } from './interface/http/llm-admin.controller.js';

/** LLM configuration (platform admin), runtime gateway, playground and ai_runs metering. */
@Module({
  imports: [ActionModule, BotModule, KnowledgeModule, WorkspaceModule, CommerceModule],
  controllers: [AiController, LlmAdminController],
  providers: [
    {
      provide: SECRET_BOX,
      useFactory: () => {
        const key = getEnv().SECRETS_ENCRYPTION_KEY;
        return key ? SecretBox.fromBase64(key) : SecretBox.insecureDevelopmentBox();
      },
    },
    {
      provide: LLM_CONFIG_REPOSITORY,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleLlmConfigRepository(db) : new InMemoryLlmConfigRepository(),
    },
    {
      provide: AI_RUN_REPOSITORY,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleAiRunRepository(db) : new InMemoryAiRunRepository(),
    },
    {
      provide: CONVERSATION_SUMMARY_REPOSITORY,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db
          ? new DrizzleConversationSummaryRepository(db)
          : new InMemoryConversationSummaryRepository(),
    },
    {
      provide: LLM_PROVIDER_FACTORY,
      inject: [SECRET_BOX],
      useFactory: (secrets: SecretBox) =>
        new SdkLlmProviderFactory(secrets, getEnv().NODE_ENV === 'production'),
    },
    {
      provide: HERMES_SUBSCRIPTION_LOGIN,
      useFactory: () => hermesSubscriptionLoginEnabled(getEnv()),
    },
    LlmRuntime,
    LlmAdminService,
    PlaygroundService,
    { provide: AI_FACADE, useExisting: PlaygroundService },
  ],
  exports: [AI_FACADE],
})
export class AiModule {}
