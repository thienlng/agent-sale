import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { ANALYTICS_FACADE, ANALYTICS_RUNNER } from './api/analytics.facade.js';
import { AnalyticsFacadeImpl } from './application/analytics.facade.impl.js';
import { ProjectorService } from './application/projector.service.js';
import { FACT_STORE, PROJECTION_STORE } from './domain/ports/projection.js';
import { DrizzleFactStore } from './infrastructure/persistence/facts.drizzle.js';
import { DrizzleProjectionStore } from './infrastructure/persistence/projection.drizzle.js';
import {
  UnavailableFactStore,
  UnavailableProjectionStore,
} from './infrastructure/persistence/unavailable.js';
import { AnalyticsController } from './interface/http/analytics.controller.js';

/** Statistics: definitions, the event-fed projection and (T-041) queries. Needs a database to project. */
@Module({
  controllers: [AnalyticsController],
  providers: [
    {
      provide: PROJECTION_STORE,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleProjectionStore(db) : new UnavailableProjectionStore(),
    },
    {
      provide: FACT_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleFactStore(db) : new UnavailableFactStore(),
    },
    ProjectorService,
    { provide: ANALYTICS_FACADE, useClass: AnalyticsFacadeImpl },
    { provide: ANALYTICS_RUNNER, useExisting: ProjectorService },
  ],
  exports: [ANALYTICS_FACADE, ANALYTICS_RUNNER],
})
export class AnalyticsModule {}
