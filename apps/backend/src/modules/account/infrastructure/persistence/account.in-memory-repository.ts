import type { UserId } from '@agent-sales/shared';

import type { NewAccount } from '../../domain/account.js';
import type { AccountRepository } from '../../domain/ports/account.repository.js';

/** DB-less runs and tests. */
export class InMemoryAccountRepository implements AccountRepository {
  readonly accounts: NewAccount[] = [];

  async ownedBy(user: UserId): Promise<string[]> {
    return this.accounts.filter((a) => a.ownerUserId === user).map((a) => a.id);
  }

  async createWithOwner(account: NewAccount): Promise<void> {
    this.accounts.push(account);
  }
}
