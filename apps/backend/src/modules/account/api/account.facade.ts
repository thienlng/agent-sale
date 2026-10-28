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
}

export const ACCOUNT_FACADE = Symbol('ACCOUNT_FACADE');
