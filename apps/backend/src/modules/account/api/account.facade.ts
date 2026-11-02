import type { UserId } from '@agent-sales/shared';

import type { AccountStatus } from '@agent-sales/contracts';

export type { AccountStatus };

/** Who the account belongs to, for the account-created event (HQ adoption keys, ADR-021 §4). */
export interface AccountOwnerInfo {
  name: string;
  email: string;
  phone: string | null;
}

/** An account as the platform admin sees it (no business data). */
export interface AdminAccount {
  id: string;
  name: string;
  status: AccountStatus;
  statusReason: string;
  statusChangedAt: Date | null;
  createdAt: Date;
  /** The oldest active owner; null for a broken account. */
  ownerUserId: string | null;
}

export interface AdminAccountMember {
  userId: string;
  role: 'owner' | 'billing';
}

export interface AdminAccountQuery {
  /** Case-insensitive substring of the account name… */
  q?: string | undefined;
  /** …or an account owned by one of these users (owner search by email/phone, resolved upstream). */
  ownerUserIds?: readonly string[] | undefined;
  /** Restrict to these accounts (billing filters, resolved upstream). */
  accountIds?: readonly string[] | undefined;
  /** Leave out these accounts (e.g. "on the free plan" = every account without a paid row). */
  excludeAccountIds?: readonly string[] | undefined;
  status?: AccountStatus | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** A platform operator's change: who and why (ADR-021 §6). */
export interface OperatorAction {
  actorUserId: string | null;
  actorName: string | null;
  reason: string;
}

/** PUBLIC CONTRACT of the account module (ADR-012). Accounts own businesses (workspaces). */
export interface AccountFacade {
  /**
   * The account a new business goes under: `accountId` when the user owns it (else
   * `NOT_FOUND`); otherwise the user's only owned account, a new one when they own none,
   * and `VALIDATION_FAILED` when they own several. Paying grants no business access.
   * A new account writes `account.account.created.v1` with `owner` and `firstBusiness`
   * (ADR-021 §2); without `owner` (a business created outside signup) the contact fields are empty.
   */
  resolveForNewBusiness(input: {
    userId: UserId;
    accountId?: string | undefined;
    businessName: string;
    owner?: AccountOwnerInfo | undefined;
    firstBusiness?: { workspaceId: string; industry: string } | undefined;
  }): Promise<string>;
  /** Accounts the user belongs to, with the account role (bootstrap, account menu). */
  listForUser(userId: UserId): Promise<AccountMembership[]>;
  /**
   * Names of the accounts owning these businesses, for grouping the business switcher.
   * Pass only account ids of businesses the user is a member of; names only, no content.
   */
  namesOf(accountIds: readonly string[]): Promise<Map<string, string>>;

  // ─── Platform admin only (backoffice, ADR-021 §6); never call from tenant routes ───
  /** Accounts, newest first, keyset-paged. */
  listForAdmin(
    query: AdminAccountQuery,
  ): Promise<{ data: AdminAccount[]; nextCursor: string | null }>;
  /** Accounts by id, any status (missing ids are left out). */
  getForAdmin(accountIds: readonly string[]): Promise<AdminAccount[]>;
  /** Active owner and billing members. */
  membersForAdmin(accountId: string): Promise<AdminAccountMember[]>;
  /**
   * Suspends or reactivates an account, with platform audit and
   * `account.account.status_changed.v1`. NOT_FOUND / CONFLICT (already in that status).
   */
  setStatus(accountId: string, status: AccountStatus, action: OperatorAction): Promise<void>;
}

export interface AccountMembership {
  accountId: string;
  name: string;
  role: 'owner' | 'billing';
}

export const ACCOUNT_FACADE = Symbol('ACCOUNT_FACADE');
