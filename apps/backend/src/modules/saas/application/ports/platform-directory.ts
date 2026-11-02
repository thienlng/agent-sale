/**
 * The platform accounts Rapiz HQ mirrors, as the backfill and the nightly reconcile need them.
 *
 * Boundary (ADR-021, spec R7): the live path reads only the account and billing events. A backfill
 * has to see accounts that never emitted an event (created before 0053) and the reconcile has to
 * compare against the current state, which events cannot give. The account and billing modules
 * expose no list facade yet (planned with the platform admin: `listForAdmin`, `accountSubscription`),
 * so the adapter is a read-only `app_system` query in saas infrastructure. It is the one place saas
 * reads platform tables; swap it for those facades when they land. It never writes.
 */
export interface PlatformAccount {
  accountId: string;
  ownerName: string;
  /** Link keys for adoption. Never logged. */
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
    updatedAt: string;
  } | null;
}

export interface PlatformDirectory {
  /** Accounts ordered by id, after `afterId` (exclusive), at most `limit`. */
  listAccounts(afterId: string | null, limit: number): Promise<PlatformAccount[]>;
}
export const PLATFORM_DIRECTORY = Symbol('PLATFORM_DIRECTORY');
