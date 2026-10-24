import { ChannelModule } from './modules/channel/channel.module.js';
import { ConversationModule } from './modules/conversation/conversation.module.js';
import { Module } from '@nestjs/common';

import { DbModule } from './common/db/db.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { CommerceModule } from './modules/commerce/commerce.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { TeamModule } from './modules/team/team.module.js';
import { BotModule } from './modules/bot/bot.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';

/**
 * Root module for the `api` entry. Register every domain module here; the
 * worker/agent/realtime entries import only the modules they need.
 */
@Module({
  imports: [
    DbModule,
    HealthModule,
    IdentityModule,
    WorkspaceModule,
    BotModule,
    AiModule,
    CommerceModule,
    ChannelModule,
    ConversationModule,
    CrmModule,
    TeamModule,
    BillingModule,
    AnalyticsModule,
    AuditModule,
  ],
})
export class AppModule {}
