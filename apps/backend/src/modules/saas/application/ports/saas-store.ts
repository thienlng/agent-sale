import type { SaasStage, SaasSubscriptionDto, SaasSummary } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

export type SubscriptionRecord = Omit<SaasSubscriptionDto, 'contactName'>;
export interface SaasActor {
  userId: string | null;
  name: string | null;
}

export interface SaasTx {
  /** Serializes writers of one key until the transaction ends. */
  lockKey(key: string): Promise<void>;
  findSubscription(contactId: string, lock?: boolean): Promise<SubscriptionRecord | null>;
  /**
   * Most recently updated first (soonest trial end first with `trialEnds`); up to 101 rows.
   * `trialEnds` keeps trials ending on `from`..`before` (yyyy-mm-dd, `before` excluded).
   */
  listSubscriptions(filter: {
    stage?: SaasStage | undefined;
    contactIds?: readonly string[] | undefined;
    trialEnds?: { from: string; before: string } | undefined;
    offset: number;
  }): Promise<SubscriptionRecord[]>;
  insertSubscription(row: SubscriptionRecord): Promise<void>;
  updateSubscription(row: SubscriptionRecord): Promise<void>;
  /** `today`..`soon` (yyyy-mm-dd, `soon` excluded) bounds "trials ending soon". */
  summary(today: string, soon: string): Promise<SaasSummary>;
  audit(
    actor: SaasActor,
    action: string,
    target: { type: string; id: string },
    data: Record<string, unknown>,
  ): Promise<void>;
}
export interface SaasStore {
  run<T>(workspaceId: WorkspaceId, fn: (tx: SaasTx) => Promise<T>): Promise<T>;
}
export const SAAS_STORE = Symbol('SAAS_STORE');
