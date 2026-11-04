import type { AccountCreatedV1 } from '@agent-sales/contracts';
import { newId, type UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import {
  type AccountOwnerInfo,
  accountNameFor,
  pickAccountForNewBusiness,
} from '../../../domain/account.js';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../../../domain/ports/account.repository.js';

/**
 * The account a new business is created under (ADR-012 §3). Creating the account is its
 * own system transaction, before the business: if the business step fails, the empty
 * account is reused by the next attempt (the user's only owned account). A new account
 * writes `account.account.created.v1` in that transaction (ADR-021 §2).
 */
@Injectable()
export class ResolveBusinessAccountHandler {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository) {}

  async execute(input: {
    userId: UserId;
    accountId?: string | undefined;
    businessName: string;
    owner?: AccountOwnerInfo | undefined;
    firstBusiness?: { workspaceId: string; industry: string } | undefined;
  }): Promise<string> {
    return this.accounts.resolveForOwner(input.userId, (owned) => {
      const picked = pickAccountForNewBusiness({ requested: input.accountId, owned });
      if (picked) return picked;
      const id = newId();
      const name = accountNameFor(input);
      const createdEvent: AccountCreatedV1 = {
        type: 'account.account.created.v1',
        accountId: id,
        ownerUserId: input.userId,
        name,
        ownerName: input.owner?.name ?? '',
        ownerEmail: input.owner?.email ?? '',
        ownerPhone: input.owner?.phone ?? null,
        workspaceId: input.firstBusiness?.workspaceId ?? null,
        industry: input.firstBusiness?.industry ?? null,
        occurredAt: new Date().toISOString(),
      };
      return { id, name, ownerUserId: input.userId, createdEvent };
    });
  }
}
