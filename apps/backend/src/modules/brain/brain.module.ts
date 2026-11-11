import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { AccountModule } from '../account/account.module.js';
import { AiModule } from '../ai/ai.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { BRAIN_FACADE } from './api/brain.facade.js';
import { BRAIN_RUNNER } from './api/brain.runner.js';
import { BrainFacadeImpl } from './application/brain.facade.impl.js';
import { ComplaintAlert } from './application/complaint-alert.js';
import { SettingsService } from './application/settings.service.js';
import { SignalEvaluator } from './application/signal-evaluator.js';
import { SignalRunner } from './application/signal-runner.js';
import { SignalScheduler } from './application/signal-scheduler.js';
import { UsageService } from './application/usage.service.js';
import { BRAIN_STORE, MESSAGE_EVENT_SOURCE } from './domain/ports/brain.store.js';
import { DrizzleBrainStore } from './infrastructure/persistence/brain.drizzle-store.js';
import { DrizzleMessageEventSource } from './infrastructure/persistence/message-events.drizzle.js';
import {
  UnavailableBrainStore,
  UnavailableMessageEventSource,
} from './infrastructure/persistence/unavailable.js';
import { BrainController, SignalsController } from './interface/http/brain.controller.js';

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
  ],
  controllers: [SignalsController, BrainController],
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
    SettingsService,
    UsageService,
    ComplaintAlert,
    SignalEvaluator,
    SignalScheduler,
    SignalRunner,
    BrainFacadeImpl,
    { provide: BRAIN_FACADE, useExisting: BrainFacadeImpl },
    { provide: BRAIN_RUNNER, useExisting: SignalRunner },
  ],
  exports: [BRAIN_FACADE, BRAIN_RUNNER],
})
export class BrainModule {}
