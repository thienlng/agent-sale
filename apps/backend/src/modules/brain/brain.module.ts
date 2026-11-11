import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { AccountModule } from '../account/account.module.js';
import { AiModule } from '../ai/ai.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { BotModule } from '../bot/bot.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LodgingModule } from '../lodging/lodging.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { BRAIN_EXPORT } from './api/brain-export.js';
import { BRAIN_FACADE } from './api/brain.facade.js';
import { BRAIN_RUNNER } from './api/brain.runner.js';
import { BrainFacadeImpl } from './application/brain.facade.impl.js';
import { Briefing } from './application/briefing.js';
import { ComplaintAlert } from './application/complaint-alert.js';
import { ReplyDraftService } from './application/reply-draft.service.js';
import { SettingsService } from './application/settings.service.js';
import { SignalEvaluator } from './application/signal-evaluator.js';
import { SignalRunner } from './application/signal-runner.js';
import { SignalScheduler } from './application/signal-scheduler.js';
import { TodayQuery } from './application/today.query.js';
import { UsageService } from './application/usage.service.js';
import { BRAIN_STORE, MESSAGE_EVENT_SOURCE } from './domain/ports/brain.store.js';
import { BrainExportSource } from './infrastructure/export/brain.export.js';
import { DrizzleBrainStore } from './infrastructure/persistence/brain.drizzle-store.js';
import { DrizzleMessageEventSource } from './infrastructure/persistence/message-events.drizzle.js';
import {
  UnavailableBrainStore,
  UnavailableMessageEventSource,
} from './infrastructure/persistence/unavailable.js';
import { BrainController, SignalsController } from './interface/http/brain.controller.js';
import { ReplyDraftController, TodayController } from './interface/http/today.controller.js';

/** Business Brain v1 (spec 2026-11-11, ADR-030): conversation signals, cap, settings, alert. */
@Module({
  imports: [
    ConversationModule,
    CrmModule,
    AiModule,
    BillingModule,
    NotificationModule,
    WorkspaceModule,
    AccountModule,
    IdentityModule,
    BotModule,
    CommerceModule,
    LodgingModule,
  ],
  controllers: [SignalsController, BrainController, TodayController, ReplyDraftController],
  providers: [
    {
      provide: BRAIN_STORE,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
      ],
      useFactory: (tenant: Database | null | undefined, system: Database | null | undefined) =>
        tenant && system ? new DrizzleBrainStore(tenant, system) : new UnavailableBrainStore(),
    },
    {
      provide: MESSAGE_EVENT_SOURCE,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (system: Database | null | undefined) =>
        system ? new DrizzleMessageEventSource(system) : new UnavailableMessageEventSource(),
    },
    {
      provide: BRAIN_EXPORT,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) => new BrainExportSource(db ?? null),
    },
    SettingsService,
    UsageService,
    ComplaintAlert,
    SignalEvaluator,
    SignalScheduler,
    TodayQuery,
    ReplyDraftService,
    Briefing,
    SignalRunner,
    BrainFacadeImpl,
    { provide: BRAIN_FACADE, useExisting: BrainFacadeImpl },
    { provide: BRAIN_RUNNER, useExisting: SignalRunner },
  ],
  exports: [BRAIN_FACADE, BRAIN_RUNNER, BRAIN_EXPORT],
})
export class BrainModule {}
