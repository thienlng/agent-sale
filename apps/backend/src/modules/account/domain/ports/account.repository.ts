import type { UserId } from '@agent-sales/shared';

import type { NewAccount } from '../account.js';

/** Global tables (no tenant): adapters run as app_system and always filter by the user. */
export interface AccountRepository {
  /** Ids of the active accounts where `user` is an active owner, oldest first. */
  ownedBy(user: UserId): Promise<string[]>;
  /** Creates the account and its owner membership in one transaction. */
  createWithOwner(account: NewAccount): Promise<void>;
}

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');
