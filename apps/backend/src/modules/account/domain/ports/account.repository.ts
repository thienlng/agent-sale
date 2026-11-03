import type { UserId } from '@agent-sales/shared';

import type {
  AccountMembership,
  AccountStatus,
  AdminAccount,
  AdminAccountMember,
  AdminAccountQuery,
  NewAccount,
} from '../account.js';

/** Who changed something and why (platform operator, ADR-021 §6). */
export interface OperatorAction {
  actorUserId: string | null;
  actorName: string | null;
  reason: string;
}

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

  // ─── Platform admin (ADR-021): never reachable from tenant routes ──────────
  /** Newest first, keyset-paged. */
  listForAdmin(
    query: AdminAccountQuery,
  ): Promise<{ data: AdminAccount[]; nextCursor: string | null }>;
  /** Accounts by id (any status). */
  byIds(ids: readonly string[]): Promise<AdminAccount[]>;
  /** Active owner and billing members of an account. */
  membersOf(accountId: string): Promise<AdminAccountMember[]>;
  /**
   * Sets the status (with reason) and writes the platform audit row and the
   * `account.account.status_changed.v1` event in the same transaction. Returns the previous
   * status; NOT_FOUND when the account does not exist.
   */
  setStatus(
    accountId: string,
    status: AccountStatus,
    action: OperatorAction,
    check: (from: AccountStatus) => void,
    now: Date,
  ): Promise<AccountStatus>;
}

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');
