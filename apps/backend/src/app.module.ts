import { Module } from '@nestjs/common';

import { DbModule } from './common/db/db.module.js';
import { BotModule } from './modules/bot/bot.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';

/**
 * Root module for the `api` entry. Register every domain module here; the
 * worker/agent/realtime entries import only the modules they need.
 */
@Module({
  imports: [DbModule, HealthModule, IdentityModule, WorkspaceModule, BotModule],
})
export class AppModule {}
