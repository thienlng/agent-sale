import type { UserId } from '@agent-sales/shared';

import type { AccountMembership, NewAccount } from '../../domain/account.js';
import type { AccountRepository } from '../../domain/ports/account.repository.js';

/** DB-less runs and tests. */
export class InMemoryAccountRepository implements AccountRepository {
  readonly accounts: NewAccount[] = [];

  async ownedBy(user: UserId): Promise<string[]> {
    return this.accounts.filter((a) => a.ownerUserId === user).map((a) => a.id);
  }

  async membershipsOf(user: UserId): Promise<AccountMembership[]> {
    return this.accounts
      .filter((a) => a.ownerUserId === user)
      .map((a) => ({ accountId: a.id, name: a.name, role: 'owner' as const }));
  }

  async namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    return new Map(this.accounts.filter((a) => ids.includes(a.id)).map((a) => [a.id, a.name]));
  }

  async createWithOwner(account: NewAccount): Promise<void> {
    this.accounts.push(account);
  }
}
