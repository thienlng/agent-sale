import type { UserId } from '@agent-sales/shared';

import type { NewAccount } from '../account.js';

/** Global tables (no tenant): adapters run as app_system and always filter by the user. */
export interface AccountRepository {
  /**
   * Hands `decide` the ids of the active accounts where `user` is an active owner (oldest
   * first) and creates the account it returns, with its owner membership. The read and the
   * create share one transaction under a per-user lock, so concurrent business creations (a
   * double submit, signup retries) cannot each create an account and leave several behind.
   */
  resolveForOwner(user: UserId, decide: (owned: string[]) => string | NewAccount): Promise<string>;
}

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');
