/**
 * The platform accounts Rapiz HQ mirrors, as the backfill and the nightly reconcile need them.
 *
 * The live path reads only the account and billing events. A backfill has to see accounts that
 * never emitted an event (created before 0053) and the reconcile has to compare against the
 * current state, which events cannot give; both read it through the `account`, `billing` and
 * `identity` admin facades (`application/platform-directory.ts`). Read only.
 */
export interface PlatformAccount {
  accountId: string;
  ownerName: string;
  /** Link keys for adoption. Never logged. Empty when the account has no owner. */
  ownerEmail: string;
  ownerPhone: string | null;
  status: 'active' | 'suspended';
  createdAt: string;
  subscription: {
    planCode: string;
    planName: string;
    periodMonths: number | null;
    status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';
    periodStart: string | null;
    periodEnd: string | null;
    mrrVnd: number;
    /** A stable date of the current state (the period start): the reconcile's `occurredAt`. */
    since: string;
  } | null;
}

export interface PlatformDirectory {
  /** One page of accounts (newest first) and the cursor of the next, null after the last. */
  listAccounts(
    cursor: string | null,
    limit: number,
  ): Promise<{ data: PlatformAccount[]; nextCursor: string | null }>;
}
export const PLATFORM_DIRECTORY = Symbol('PLATFORM_DIRECTORY');
