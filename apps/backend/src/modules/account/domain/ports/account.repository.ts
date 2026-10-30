import type { UserId } from '@agent-sales/shared';

import type { AccountMembership, NewAccount } from '../account.js';

/** Global tables (no tenant): adapters run as app_system and always filter by the user. */
export interface AccountRepository {
  /** Active accounts where `user` is an active member, oldest first. */
  membershipsOf(user: UserId): Promise<AccountMembership[]>;
  /** Names of these accounts (the caller passes only ids it may show). */
  namesOf(ids: readonly string[]): Promise<Map<string, string>>;
  /**
   * Hands `decide` the ids of the active accounts where `user` is an active owner (oldest
   * first) and creates the account it returns, with its owner membership. The read and the
   * create share one transaction under a per-user lock, so concurrent business creations (a
   * double submit, signup retries) cannot each create an account and leave several behind.
   */
  resolveForOwner(user: UserId, decide: (owned: string[]) => string | NewAccount): Promise<string>;
}

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');
