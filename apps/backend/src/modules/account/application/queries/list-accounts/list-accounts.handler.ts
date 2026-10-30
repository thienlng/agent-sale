import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { AccountMembership } from '../../../domain/account.js';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../../../domain/ports/account.repository.js';

/** Account reads for the signed-in user; every query is keyed by the user (ADR-012 §2). */
@Injectable()
export class ListAccountsHandler {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository) {}

  forUser(user: UserId): Promise<AccountMembership[]> {
    return this.accounts.membershipsOf(user);
  }

  namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    return this.accounts.namesOf([...new Set(ids)]);
  }
}
