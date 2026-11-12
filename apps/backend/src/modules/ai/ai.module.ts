import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { getEnv, hermesSubscriptionLoginEnabled } from '../../common/config.js';
import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import {
  conversationLlmBudgetFromEnv,
  ownerLlmBudgetFromEnv,
} from '../../common/limits/llm-budget.js';
import { sharedLimiter } from '../../common/limits/limiter.js';
import { SECRET_BOX, SecretBox } from '../../common/security/secret-box.js';
import { ActionModule } from '../action/action.module.js';
import { BotModule } from '../bot/bot.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { LodgingModule } from '../lodging/lodging.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { AI_FACADE } from './api/ai.facade.js';
import { AI_TRACE_RUNNER } from './api/ai-trace-runner.js';
import { AI_LLM_GATEWAY } from './api/llm-gateway.port.js';
import { AiTraceRunnerImpl } from './application/ai-trace.runner.js';
import { HERMES_SUBSCRIPTION_LOGIN, LlmAdminService } from './application/llm-admin.service.js';
import { LlmRuntime } from './application/llm-runtime.js';
import { BotCommitQuota } from './application/commit-quota.js';
import { AI_SPEND_LIMITS } from './application/spend-guard.js';
import { MEDIA_PUBLIC_BASE, PlaygroundService } from './application/playground.service.js';
import { LLM_PROVIDER_FACTORY } from './application/ports/llm-provider-factory.js';
import { TurnTraceService } from './application/turn-trace.service.js';
import { AI_RUN_REPOSITORY, type AiRunRepository } from './domain/ports/ai-run.repository.js';
import { CONVERSATION_SUMMARY_REPOSITORY } from './domain/ports/conversation-summary.repository.js';
import { LLM_CONFIG_REPOSITORY } from './domain/ports/llm-config.repository.js';
import { TURN_TRACE_REPOSITORY } from './domain/ports/turn-trace.repository.js';
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
import {
  DrizzleTurnTraceRepository,
  InMemoryTurnTraceRepository,
} from './infrastructure/persistence/turn-trace.repositories.js';
import { AiController } from './interface/http/ai.controller.js';
import { LlmAdminController } from './interface/http/llm-admin.controller.js';
import { TurnTraceController } from './interface/http/turn-trace.controller.js';

/** LLM configuration (platform admin), runtime gateway, playground and ai_runs metering. */
@Module({
  imports: [
    ActionModule,
    BotModule,
    KnowledgeModule,
    WorkspaceModule,
    CommerceModule,
    LodgingModule,
    CrmModule,
  ],
  controllers: [AiController, LlmAdminController, TurnTraceController],
  providers: [
    {
      // Model spend caps (security audit 2026-11-12 #15).
      provide: AI_SPEND_LIMITS,
      useFactory: () => ({
        conversation: conversationLlmBudgetFromEnv(),
        owner: ownerLlmBudgetFromEnv(),
        commits: new BotCommitQuota(
          {
            ordersPerContactDay: getEnv().BOT_ORDERS_CONTACT_DAY,
            holdsPerContactDay: getEnv().BOT_HOLDS_CONTACT_DAY,
          },
          sharedLimiter(),
        ),
      }),
    },
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
      provide: TURN_TRACE_REPOSITORY,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
        AI_RUN_REPOSITORY,
      ],
      useFactory: (
        db: Database | null | undefined,
        systemDb: Database | null | undefined,
        runs: AiRunRepository,
      ) =>
        db
          ? new DrizzleTurnTraceRepository(db, systemDb)
          : new InMemoryTurnTraceRepository(runs as InMemoryAiRunRepository),
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
    { provide: MEDIA_PUBLIC_BASE, useFactory: () => getEnv().S3_PUBLIC_URL ?? '' },
    LlmRuntime,
    { provide: AI_LLM_GATEWAY, useExisting: LlmRuntime },
    LlmAdminService,
    PlaygroundService,
    { provide: AI_FACADE, useExisting: PlaygroundService },
    TurnTraceService,
    AiTraceRunnerImpl,
    { provide: AI_TRACE_RUNNER, useExisting: AiTraceRunnerImpl },
  ],
  exports: [AI_FACADE, AI_LLM_GATEWAY, AI_TRACE_RUNNER],
})
export class AiModule {}
