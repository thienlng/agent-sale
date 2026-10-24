import { Module } from '@nestjs/common';
import type { Database } from '@agent-sales/db';
import { DB_TENANT } from '../../common/db/db.module.js';
import { ChannelModule } from '../channel/channel.module.js';
import { AiModule } from '../ai/ai.module.js';
import { BotModule } from '../bot/bot.module.js';
import { CONVERSATION_FACADE, CONVERSATION_RUNNER } from './api/conversation.facade.js';
import { ConversationFacadeImpl } from './application/conversation.facade.impl.js';
import { CONVERSATION_STORE } from './application/ports/conversation-store.js';
import { BOT_IMAGE_VISION, IMAGE_FETCHER } from './application/ports/image-fetcher.js';
import { botImageExtraHosts, botImageVisionEnabled, getEnv } from '../../common/config.js';
import { SafeImageFetcher } from './infrastructure/media/safe-image-fetcher.js';
import { MetaInboxProcessor } from './application/jobs/meta-inbox.processor.js';
import {
  DrizzleConversationStore,
  UnavailableConversationStore,
} from './infrastructure/persistence/conversation.store.js';
import { ConversationController } from './interface/http/conversation.controller.js';
@Module({
  imports: [ChannelModule, AiModule, BotModule],
  controllers: [ConversationController],
  providers: [
    {
      provide: CONVERSATION_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleConversationStore(db) : new UnavailableConversationStore(),
    },
    ConversationFacadeImpl,
    { provide: CONVERSATION_FACADE, useExisting: ConversationFacadeImpl },
    {
      provide: IMAGE_FETCHER,
      useFactory: () => new SafeImageFetcher(botImageExtraHosts(getEnv())),
    },
    { provide: BOT_IMAGE_VISION, useFactory: () => botImageVisionEnabled(getEnv()) },
    MetaInboxProcessor,
    { provide: CONVERSATION_RUNNER, useExisting: MetaInboxProcessor },
  ],
  exports: [CONVERSATION_FACADE, CONVERSATION_RUNNER],
})
export class ConversationModule {}
