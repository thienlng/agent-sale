import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { ActionModule } from '../action/action.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { BOT_LIFECYCLE, BotLifecycle } from './api/bot-lifecycle.js';
import { BOT_EXPORT } from './api/bot-export.js';
import { BOT_FACADE } from './api/bot.facade.js';
import { BOT_SETUP } from './api/bot-setup.js';
import { BotService } from './application/bot.service.js';
import { BotExportSource } from './infrastructure/export/bot.export.js';
import { BOT_UOW } from './application/ports/bot-unit-of-work.js';
import { DrizzleBotUnitOfWork, InMemoryBotUnitOfWork } from './infrastructure/bot.persistence.js';
import { ActionController } from './interface/http/action.controller.js';
import { TrainingController } from './interface/http/training.controller.js';
import { BotController } from './interface/http/bot.controller.js';
import { MediaController } from './interface/http/media.controller.js';

@Module({
  imports: [KnowledgeModule, IdentityModule, ActionModule, WorkspaceModule],
  controllers: [BotController, TrainingController, MediaController, ActionController],
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
    { provide: BOT_SETUP, useExisting: BotService },
    {
      provide: BOT_EXPORT,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) => new BotExportSource(db ?? null),
    },
  ],
  exports: [BOT_FACADE, BOT_SETUP, BOT_LIFECYCLE, BOT_EXPORT],
})
export class BotModule {}
