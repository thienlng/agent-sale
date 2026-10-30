import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM } from '../../common/db/db.module.js';
import { ACCOUNT_FACADE } from './api/account.facade.js';
import { AccountFacadeImpl } from './application/account.facade.impl.js';
import { ListAccountsHandler } from './application/queries/list-accounts/list-accounts.handler.js';
import { ResolveBusinessAccountHandler } from './application/commands/resolve-business-account/resolve-business-account.handler.js';
import { ACCOUNT_REPOSITORY } from './domain/ports/account.repository.js';
import { DrizzleAccountRepository } from './infrastructure/persistence/account.drizzle-repository.js';
import { InMemoryAccountRepository } from './infrastructure/persistence/account.in-memory-repository.js';
import { AccountController } from './interface/http/account.controller.js';

/**
 * Accounts are global (ADR-012): the repository uses the system database and filters
 * every query by the user. Without a database the in-memory adapter is used. Exports
 * ONLY what api/ declares.
 */
@Module({
  controllers: [AccountController],
  providers: [
    ResolveBusinessAccountHandler,
    ListAccountsHandler,
    {
      provide: ACCOUNT_REPOSITORY,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleAccountRepository(db) : new InMemoryAccountRepository(),
    },
    { provide: ACCOUNT_FACADE, useClass: AccountFacadeImpl },
  ],
  exports: [ACCOUNT_FACADE],
})
export class AccountModule {}
