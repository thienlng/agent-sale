import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { getEnv } from '../../common/config.js';
import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { INTEGRATION_FACADE } from './api/integration.facade.js';
import { IntegrationFacadeImpl } from './application/integration.facade.impl.js';
import { INTEGRATION_STORE } from './application/ports/integration-store.js';
import { KIOTVIET_GATEWAY } from './application/ports/kiotviet-gateway.js';
import { KiotVietClient } from './infrastructure/clients/kiotviet-client.js';
import { DrizzleIntegrationStore } from './infrastructure/persistence/integration.drizzle-store.js';
import { UnavailableIntegrationStore } from './infrastructure/persistence/unavailable-store.js';
import { IntegrationController } from './interface/http/integration.controller.js';

/** Bind ports to adapters here. Export ONLY what api/ declares. */
@Module({
  controllers: [IntegrationController],
  providers: [
    { provide: INTEGRATION_FACADE, useClass: IntegrationFacadeImpl },
    {
      provide: INTEGRATION_STORE,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
      ],
      useFactory: (db: Database | null | undefined, system: Database | null | undefined) =>
        db && system ? new DrizzleIntegrationStore(db, system) : new UnavailableIntegrationStore(),
    },
    { provide: KIOTVIET_GATEWAY, useFactory: () => KiotVietClient.fromEnv(getEnv()) },
  ],
  exports: [INTEGRATION_FACADE],
})
export class IntegrationModule {}
