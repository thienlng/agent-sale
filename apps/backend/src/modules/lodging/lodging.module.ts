import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { BotModule } from '../bot/bot.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { LODGING_FACADE } from './api/lodging.facade.js';
import { LodgingAccess } from './application/lodging-access.js';
import { LodgingFacadeImpl } from './application/lodging.facade.impl.js';
import { LodgingSettingsService } from './application/lodging-settings.service.js';
import { LODGING_STORE, type LodgingStore } from './application/ports/lodging-store.js';
import { PropertyService } from './application/property.service.js';
import { RatesService } from './application/rates.service.js';
import { LodgingUnavailableError } from './domain/lodging.errors.js';
import { DrizzleLodgingStore } from './infrastructure/persistence/lodging.drizzle-store.js';
import { PropertiesController } from './interface/http/properties.controller.js';

/** Lodging v2 (T-160). Needs a database; without one every call answers 503. */
@Module({
  imports: [WorkspaceModule, BotModule],
  controllers: [PropertiesController],
  providers: [
    {
      provide: LODGING_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined): LodgingStore =>
        db
          ? new DrizzleLodgingStore(db)
          : { run: () => Promise.reject(new LodgingUnavailableError()) },
    },
    LodgingAccess,
    PropertyService,
    RatesService,
    LodgingSettingsService,
    { provide: LODGING_FACADE, useClass: LodgingFacadeImpl },
  ],
  exports: [LODGING_FACADE],
})
export class LodgingModule {}
