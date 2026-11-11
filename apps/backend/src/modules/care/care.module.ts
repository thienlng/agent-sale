import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { AiModule } from '../ai/ai.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { BotModule } from '../bot/bot.module.js';
import { BrainModule } from '../brain/brain.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LodgingModule } from '../lodging/lodging.module.js';
import { CARE_EXPORT } from './api/care-export.js';
import { CARE_FACADE } from './api/care.facade.js';
import { CARE_RUNNER } from './api/care.runner.js';
import { ApprovalService } from './application/approval.service.js';
import { CARE_EVENTS, CareEnroller } from './application/care-enroller.js';
import { CareGuard } from './application/care-guard.js';
import { CareRunnerImpl } from './application/care-runner.js';
import { CareSender } from './application/care-sender.js';
import { CareSettingsService } from './application/care-settings.service.js';
import { CareStep } from './application/care-step.js';
import { CareTodaySourceImpl } from './application/care-today.source.js';
import { CareWriter } from './application/care-writer.service.js';
import { CareFacadeImpl } from './application/care.facade.impl.js';
import { ImpactQuery } from './application/impact.query.js';
import { CARE_EVENT_SOURCE, CARE_STORE } from './domain/ports/care.store.js';
import { CareExportSource } from './infrastructure/export/care.export.js';
import { DrizzleCareEventSource } from './infrastructure/persistence/care-events.drizzle.js';
import { DrizzleCareStore } from './infrastructure/persistence/care.drizzle-store.js';
import {
  UnavailableCareEventSource,
  UnavailableCareStore,
} from './infrastructure/persistence/unavailable.js';
import {
  CareController,
  CareTodayController,
  ImpactController,
} from './interface/http/care.controller.js';

/** The care agent (spec 2026-11-11 care-agent-autonomy, ADR-031). Nothing depends on it but dataexport. */
@Module({
  imports: [
    BrainModule,
    ConversationModule,
    CommerceModule,
    LodgingModule,
    AiModule,
    BotModule,
    BillingModule,
    IdentityModule,
  ],
  controllers: [CareController, CareTodayController, ImpactController],
  providers: [
    {
      provide: CARE_STORE,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
      ],
      useFactory: (tenant: Database | null | undefined, system: Database | null | undefined) =>
        tenant && system ? new DrizzleCareStore(tenant, system) : new UnavailableCareStore(),
    },
    {
      provide: CARE_EVENT_SOURCE,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (system: Database | null | undefined) =>
        system ? new DrizzleCareEventSource(system, CARE_EVENTS) : new UnavailableCareEventSource(),
    },
    {
      provide: CARE_EXPORT,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) => new CareExportSource(db ?? null),
    },
    CareSettingsService,
    CareWriter,
    CareSender,
    CareGuard,
    CareEnroller,
    CareStep,
    ApprovalService,
    ImpactQuery,
    CareTodaySourceImpl,
    CareRunnerImpl,
    CareFacadeImpl,
    { provide: CARE_FACADE, useExisting: CareFacadeImpl },
    { provide: CARE_RUNNER, useExisting: CareRunnerImpl },
  ],
  exports: [CARE_FACADE, CARE_RUNNER, CARE_EXPORT],
})
export class CareModule {}
