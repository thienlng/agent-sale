import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { actionDevAllowHttpHosts, getEnv } from '../../common/config.js';
import { DB_TENANT } from '../../common/db/db.module.js';
import { SECRET_BOX, SecretBox } from '../../common/security/secret-box.js';
import { ACTION_FACADE } from './api/action.facade.js';
import { ActionFacadeImpl, SAFE_HTTP } from './application/action.facade.impl.js';
import { ACTION_UOW } from './application/ports/action-unit-of-work.js';
import { createSafeHttp } from './domain/safe-http.js';
import { DrizzleActionUnitOfWork } from './infrastructure/action.unit-of-work.js';
import { InMemoryActionUnitOfWork } from './infrastructure/persistence/action.in-memory-repository.js';

/** No HTTP of its own: the bot module serves /bots/{botId}/actions after checking ownership. */
@Module({
  providers: [
    {
      provide: ACTION_UOW,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleActionUnitOfWork(db) : new InMemoryActionUnitOfWork(),
    },
    {
      provide: SECRET_BOX,
      useFactory: () =>
        getEnv().SECRETS_ENCRYPTION_KEY
          ? SecretBox.fromBase64(getEnv().SECRETS_ENCRYPTION_KEY ?? '')
          : SecretBox.insecureDevelopmentBox(),
    },
    {
      provide: SAFE_HTTP,
      useFactory: () => createSafeHttp({ allowHttpHosts: actionDevAllowHttpHosts(getEnv()) }),
    },
    { provide: ACTION_FACADE, useClass: ActionFacadeImpl },
  ],
  exports: [ACTION_FACADE],
})
export class ActionModule {}
