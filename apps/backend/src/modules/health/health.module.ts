import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { CheckReadiness } from './application/check-readiness.js';
import { READINESS_PROBES } from './application/ports/readiness-probe.js';
import { PostgresProbe } from './infrastructure/postgres.probe.js';
import { HealthController } from './interface/http/health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    CheckReadiness,
    {
      provide: READINESS_PROBES,
      inject: [{ token: DB_TENANT, optional: true }],
      // Redis and other dependencies add their probes here as they are wired.
      useFactory: (db: Database | null | undefined) => [new PostgresProbe(db)],
    },
  ],
})
export class HealthModule {}
