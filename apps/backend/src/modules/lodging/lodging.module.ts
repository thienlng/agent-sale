import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { getEnv } from '../../common/config.js';
import { DB_TENANT } from '../../common/db/db.module.js';
import { S3PublicObjectStorage } from '../../common/storage/public-object-storage.js';
import { BotModule } from '../bot/bot.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import {
  LODGING_BOT_FACADE,
  LODGING_CATALOG_FACADE,
  LODGING_FACADE,
} from './api/lodging.facade.js';
import { LodgingBotCatalog } from './application/bot-catalog.js';
import { BookingService } from './application/booking.service.js';
import { LodgingBotHolds } from './application/bot-hold.service.js';
import { CalendarService } from './application/calendar.service.js';
import { LodgingAccess } from './application/lodging-access.js';
import { LodgingFacadeImpl } from './application/lodging.facade.impl.js';
import { LodgingMediaService } from './application/lodging-media.service.js';
import { LodgingSettingsService } from './application/lodging-settings.service.js';
import { NightNotesService } from './application/night-notes.service.js';
import { LODGING_MEDIA_STORAGE } from './application/ports/lodging-media-storage.js';
import { LODGING_STORE, type LodgingStore } from './application/ports/lodging-store.js';
import { PropertyService } from './application/property.service.js';
import { RatesService } from './application/rates.service.js';
import { LodgingUnavailableError } from './domain/lodging.errors.js';
import { DrizzleLodgingStore } from './infrastructure/persistence/lodging.drizzle-store.js';
import { BookingsController } from './interface/http/bookings.controller.js';
import { CalendarController } from './interface/http/calendar.controller.js';
import { LodgingMediaController } from './interface/http/lodging-media.controller.js';
import { PropertiesController } from './interface/http/properties.controller.js';

/** Lodging v2 (T-160). Needs a database; without one every call answers 503. */
@Module({
  imports: [WorkspaceModule, BotModule],
  controllers: [
    PropertiesController,
    BookingsController,
    CalendarController,
    LodgingMediaController,
  ],
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
    BookingService,
    CalendarService,
    NightNotesService,
    {
      provide: LODGING_MEDIA_STORAGE,
      // Its own client: a 25 MB video needs a longer put than a product picture (15 s).
      useFactory: () => {
        const env = getEnv();
        return new S3PublicObjectStorage({
          endpoint: env.S3_ENDPOINT,
          bucket: env.S3_BUCKET,
          publicUrl: env.S3_PUBLIC_URL,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
          requestTimeoutMs: 120_000,
        });
      },
    },
    LodgingMediaService,
    { provide: LODGING_FACADE, useClass: LodgingFacadeImpl },
    { provide: LODGING_CATALOG_FACADE, useClass: LodgingBotCatalog },
    { provide: LODGING_BOT_FACADE, useClass: LodgingBotHolds },
  ],
  exports: [LODGING_FACADE, LODGING_CATALOG_FACADE, LODGING_BOT_FACADE],
})
export class LodgingModule {}
