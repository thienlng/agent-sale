import type { EntitlementsDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the billing module: what a workspace may use. */
export interface BillingFacade {
  /** Plan limits and features with unexpired overrides applied. */
  entitlements(workspaceId: WorkspaceId): Promise<EntitlementsDto>;
  /**
   * The numeric limit for `key` (e.g. `members.max`): `null` = unlimited,
   * and a key the plan does not define is 0 (deny by default).
   */
  limit(workspaceId: WorkspaceId, key: string): Promise<number | null>;
}

export const BILLING_FACADE = Symbol('BILLING_FACADE');
