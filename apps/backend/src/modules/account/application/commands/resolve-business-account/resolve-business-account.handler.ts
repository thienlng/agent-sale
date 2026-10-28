import { newId, type UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { accountNameFor, pickAccountForNewBusiness } from '../../../domain/account.js';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../../../domain/ports/account.repository.js';

/**
 * The account a new business is created under (ADR-012 §3). Creating the account is its
 * own system transaction, before the business: if the business step fails, the empty
 * account is reused by the next attempt (the user's only owned account).
 */
@Injectable()
export class ResolveBusinessAccountHandler {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository) {}

  async execute(input: {
    userId: UserId;
    accountId?: string | undefined;
    businessName: string;
  }): Promise<string> {
    return this.accounts.resolveForOwner(
      input.userId,
      (owned) =>
        pickAccountForNewBusiness({ requested: input.accountId, owned }) ?? {
          id: newId(),
          name: accountNameFor(input.businessName),
          ownerUserId: input.userId,
        },
    );
  }
}
