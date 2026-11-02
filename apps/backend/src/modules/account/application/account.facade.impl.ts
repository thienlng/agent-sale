import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { AccountFacade, AccountMembership } from '../api/account.facade.js';
import type {
  AccountOwnerInfo,
  AccountStatus,
  AdminAccount,
  AdminAccountMember,
  AdminAccountQuery,
} from '../domain/account.js';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
  type OperatorAction,
} from '../domain/ports/account.repository.js';
import { ResolveBusinessAccountHandler } from './commands/resolve-business-account/resolve-business-account.handler.js';
import { SetAccountStatusHandler } from './commands/set-account-status/set-account-status.handler.js';
import { ListAccountsHandler } from './queries/list-accounts/list-accounts.handler.js';

/** Delegates to command/query handlers; no logic of its own. */
@Injectable()
export class AccountFacadeImpl implements AccountFacade {
  constructor(
    @Inject(ResolveBusinessAccountHandler) private readonly resolve: ResolveBusinessAccountHandler,
    @Inject(ListAccountsHandler) private readonly list: ListAccountsHandler,
    @Inject(SetAccountStatusHandler) private readonly status: SetAccountStatusHandler,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
  ) {}

  resolveForNewBusiness(input: {
    userId: UserId;
    accountId?: string | undefined;
    businessName: string;
    owner?: AccountOwnerInfo | undefined;
    firstBusiness?: { workspaceId: string; industry: string } | undefined;
  }): Promise<string> {
    return this.resolve.execute(input);
  }

  listForUser(userId: UserId): Promise<AccountMembership[]> {
    return this.list.forUser(userId);
  }

  namesOf(accountIds: readonly string[]): Promise<Map<string, string>> {
    return this.list.namesOf(accountIds);
  }

  listForAdmin(
    query: AdminAccountQuery,
  ): Promise<{ data: AdminAccount[]; nextCursor: string | null }> {
    return this.accounts.listForAdmin(query);
  }

  getForAdmin(accountIds: readonly string[]): Promise<AdminAccount[]> {
    return this.accounts.byIds([...new Set(accountIds)]);
  }

  membersForAdmin(accountId: string): Promise<AdminAccountMember[]> {
    return this.accounts.membersOf(accountId);
  }

  setStatus(accountId: string, status: AccountStatus, action: OperatorAction): Promise<void> {
    return this.status.execute(accountId, status, action);
  }
}
