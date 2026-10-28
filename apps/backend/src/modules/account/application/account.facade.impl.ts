import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { AccountFacade, AccountMembership } from '../api/account.facade.js';
import { ListAccountsHandler } from './queries/list-accounts/list-accounts.handler.js';
import { ResolveBusinessAccountHandler } from './commands/resolve-business-account/resolve-business-account.handler.js';

/** Delegates to command/query handlers; no logic of its own. */
@Injectable()
export class AccountFacadeImpl implements AccountFacade {
  constructor(
    @Inject(ResolveBusinessAccountHandler) private readonly resolve: ResolveBusinessAccountHandler,
    @Inject(ListAccountsHandler) private readonly list: ListAccountsHandler,
  ) {}

  resolveForNewBusiness(input: {
    userId: UserId;
    accountId?: string | undefined;
    businessName: string;
  }): Promise<string> {
    return this.resolve.execute(input);
  }

  listForUser(userId: UserId): Promise<AccountMembership[]> {
    return this.list.forUser(userId);
  }

  namesOf(accountIds: readonly string[]): Promise<Map<string, string>> {
    return this.list.namesOf(accountIds);
  }
}
