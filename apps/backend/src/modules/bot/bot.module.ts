import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { BOT_LIFECYCLE, BotLifecycle } from './api/bot-lifecycle.js';
import { BOT_FACADE } from './api/bot.facade.js';
import { BotService } from './application/bot.service.js';
import { BOT_UOW } from './application/ports/bot-unit-of-work.js';
import { DrizzleBotUnitOfWork, InMemoryBotUnitOfWork } from './infrastructure/bot.persistence.js';
import { TrainingController } from './interface/http/training.controller.js';
import { BotController } from './interface/http/bot.controller.js';
import { MediaController } from './interface/http/media.controller.js';

@Module({
  imports: [KnowledgeModule, IdentityModule],
  controllers: [BotController, TrainingController, MediaController],
  providers: [
    BotService,
    {
      provide: BOT_UOW,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleBotUnitOfWork(db) : new InMemoryBotUnitOfWork(),
    },
    { provide: BOT_LIFECYCLE, useValue: new BotLifecycle() },
    { provide: BOT_FACADE, useExisting: BotService },
  ],
  exports: [BOT_FACADE, BOT_LIFECYCLE],
})
export class BotModule {}
