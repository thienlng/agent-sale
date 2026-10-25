import { FANPAGE_FACADE } from './api/fanpage.facade.js';
import { FanpageFacadeImpl } from './application/fanpage.facade.impl.js';
import { FANPAGE_STORE } from './application/ports/fanpage-store.js';
import {
  DrizzleFanpageStore,
  UnavailableFanpageStore,
} from './infrastructure/persistence/fanpage.store.js';
import { FanpageController } from './interface/http/fanpage.controller.js';
import { Module } from '@nestjs/common';
import type { Database } from '@agent-sales/db';
import { getEnv } from '../../common/config.js';
import { DB_TENANT, DB_SYSTEM } from '../../common/db/db.module.js';
import { SECRET_BOX, SecretBox } from '../../common/security/secret-box.js';
import { BotModule } from '../bot/bot.module.js';
import { CHANNEL_FACADE } from './api/channel.facade.js';
import { ChannelFacadeImpl } from './application/channel.facade.impl.js';
import { CHANNEL_STORE } from './application/ports/channel-store.js';
import { META_GATEWAY } from './application/ports/meta-gateway.js';
import { LiveMetaGateway } from './infrastructure/clients/meta-oauth.js';
import {
  DrizzleChannelStore,
  UnavailableChannelStore,
} from './infrastructure/persistence/channel.store.js';
import { ChannelController } from './interface/http/channel.controller.js';
@Module({
  imports: [BotModule],
  controllers: [ChannelController, FanpageController],
  providers: [
    {
      provide: CHANNEL_STORE,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
      ],
      useFactory: (db: Database | null | undefined, system: Database | null | undefined) =>
        db && system ? new DrizzleChannelStore(db, system) : new UnavailableChannelStore(),
    },
    { provide: META_GATEWAY, useFactory: () => new LiveMetaGateway() },
    {
      provide: SECRET_BOX,
      useFactory: () =>
        getEnv().SECRETS_ENCRYPTION_KEY
          ? SecretBox.fromBase64(getEnv().SECRETS_ENCRYPTION_KEY ?? '')
          : SecretBox.insecureDevelopmentBox(),
    },
    {
      provide: FANPAGE_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleFanpageStore(db) : new UnavailableFanpageStore(),
    },
    FanpageFacadeImpl,
    { provide: FANPAGE_FACADE, useExisting: FanpageFacadeImpl },
    ChannelFacadeImpl,
    { provide: CHANNEL_FACADE, useExisting: ChannelFacadeImpl },
  ],
  exports: [CHANNEL_FACADE, FANPAGE_FACADE],
})
export class ChannelModule {}
