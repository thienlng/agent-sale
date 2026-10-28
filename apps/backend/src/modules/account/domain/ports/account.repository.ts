import type { UserId } from '@agent-sales/shared';

import type { AccountMembership, NewAccount } from '../account.js';

/** Global tables (no tenant): adapters run as app_system and always filter by the user. */
export interface AccountRepository {
  /** Ids of the active accounts where `user` is an active owner, oldest first. */
  ownedBy(user: UserId): Promise<string[]>;
  /** Active accounts where `user` is an active member, oldest first. */
  membershipsOf(user: UserId): Promise<AccountMembership[]>;
  /** Names of these accounts (the caller passes only ids it may show). */
  namesOf(ids: readonly string[]): Promise<Map<string, string>>;
  /** Creates the account and its owner membership in one transaction. */
  createWithOwner(account: NewAccount): Promise<void>;
}

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');
