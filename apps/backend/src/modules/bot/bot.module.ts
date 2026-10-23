import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { BOT_FACADE } from './api/bot.facade.js';
import { BotService } from './application/bot.service.js';
import { BOT_UOW } from './application/ports/bot-unit-of-work.js';
import { DrizzleBotUnitOfWork, InMemoryBotUnitOfWork } from './infrastructure/bot.persistence.js';
import { BotController } from './interface/http/bot.controller.js';

@Module({
  imports: [KnowledgeModule],
  controllers: [BotController],
  providers: [
    BotService,
    {
      provide: BOT_UOW,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleBotUnitOfWork(db) : new InMemoryBotUnitOfWork(),
    },
    { provide: BOT_FACADE, useExisting: BotService },
  ],
  exports: [BOT_FACADE],
})
export class BotModule {}
