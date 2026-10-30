import type { UserId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the account module (ADR-012). Accounts own businesses (workspaces). */
export interface AccountFacade {
  /**
   * The account a new business goes under: `accountId` when the user owns it (else
   * `NOT_FOUND`); otherwise the user's only owned account, a new one when they own none,
   * and `VALIDATION_FAILED` when they own several. Paying grants no business access.
   */
  resolveForNewBusiness(input: {
    userId: UserId;
    accountId?: string | undefined;
    businessName: string;
  }): Promise<string>;
  /** Accounts the user belongs to, with the account role (bootstrap, account menu). */
  listForUser(userId: UserId): Promise<AccountMembership[]>;
  /**
   * Names of the accounts owning these businesses, for grouping the business switcher.
   * Pass only account ids of businesses the user is a member of; names only, no content.
   */
  namesOf(accountIds: readonly string[]): Promise<Map<string, string>>;
}

export interface AccountMembership {
  accountId: string;
  name: string;
  role: 'owner' | 'billing';
}

export const ACCOUNT_FACADE = Symbol('ACCOUNT_FACADE');
