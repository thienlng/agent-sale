import type { UserId } from '@agent-sales/shared';

import type { NewAccount } from '../../domain/account.js';
import type { AccountRepository } from '../../domain/ports/account.repository.js';

/** DB-less runs and tests. */
export class InMemoryAccountRepository implements AccountRepository {
  readonly accounts: NewAccount[] = [];

  // No await between the read and the push, so concurrent callers are already serialized.
  async resolveForOwner(
    user: UserId,
    decide: (owned: string[]) => string | NewAccount,
  ): Promise<string> {
    const choice = decide(this.accounts.filter((a) => a.ownerUserId === user).map((a) => a.id));
    if (typeof choice === 'string') return choice;
    this.accounts.push(choice);
    return choice.id;
  }
}
