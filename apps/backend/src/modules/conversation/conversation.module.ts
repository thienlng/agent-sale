import { FanpageCommentProcessor } from './application/jobs/fanpage-comment.processor.js';
import { Module } from '@nestjs/common';
import type { Database } from '@agent-sales/db';
import { DB_TENANT } from '../../common/db/db.module.js';
import { ChannelModule } from '../channel/channel.module.js';
import { AiModule } from '../ai/ai.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { BotModule } from '../bot/bot.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { TeamModule } from '../team/team.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { CONVERSATION_FACADE, CONVERSATION_RUNNER } from './api/conversation.facade.js';
import { CONVERSATION_EXPORT } from './api/conversation-export.js';
import { ConversationExportSource } from './infrastructure/export/conversation.export.js';
import { ConversationFacadeImpl, HUMAN_AGENT_TAG } from './application/conversation.facade.impl.js';
import { InboxAlerts } from './application/inbox-alerts.js';
import { NOTIFICATION_FACADE, type NotificationFacade } from '../notification/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../workspace/api/index.js';
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
  imports: [
    ChannelModule,
    AiModule,
    BotModule,
    BillingModule,
    IdentityModule,
    TeamModule,
    CrmModule,
    WorkspaceModule,
    NotificationModule,
  ],
  controllers: [ConversationController],
  providers: [
    {
      provide: CONVERSATION_EXPORT,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) => new ConversationExportSource(db ?? null),
    },
    {
      provide: CONVERSATION_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db
          ? new DrizzleConversationStore(db, getEnv().S3_PUBLIC_URL)
          : new UnavailableConversationStore(),
    },
    {
      provide: InboxAlerts,
      useFactory: (n: NotificationFacade, w: WorkspaceFacade) => new InboxAlerts(n, w),
      inject: [NOTIFICATION_FACADE, WORKSPACE_FACADE],
    },
    { provide: HUMAN_AGENT_TAG, useFactory: () => getEnv().META_HUMAN_AGENT_TAG === 'true' },
    ConversationFacadeImpl,
    { provide: CONVERSATION_FACADE, useExisting: ConversationFacadeImpl },
    {
      provide: IMAGE_FETCHER,
      useFactory: () => {
        const env = getEnv();
        // Website chat visitors upload to our public bucket; the bot may look at those pictures.
        const upload = env.S3_PUBLIC_URL ? [new URL(env.S3_PUBLIC_URL).hostname] : [];
        return new SafeImageFetcher(botImageExtraHosts(env), upload);
      },
    },
    { provide: BOT_IMAGE_VISION, useFactory: () => botImageVisionEnabled(getEnv()) },
    FanpageCommentProcessor,
    MetaInboxProcessor,
    { provide: CONVERSATION_RUNNER, useExisting: MetaInboxProcessor },
  ],
  exports: [CONVERSATION_FACADE, CONVERSATION_RUNNER, CONVERSATION_EXPORT],
})
export class ConversationModule {}
