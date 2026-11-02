import type {
  SaasPlanDto,
  SaasStage,
  SaasSubscriptionDto,
  SaasSubscriptionHistoryEntry,
  SaasSummary,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { Usage } from '../../domain/subscription-rules.js';

/** A subscription row; `linked`, `usage` and `upsell` of the DTO are derived from it. */
export interface SubscriptionRecord extends Omit<
  SaasSubscriptionDto,
  'contactName' | 'linked' | 'usage' | 'upsell'
> {
  /** Set by a sync (Rapiz HQ): the synced fields are read-only for staff. */
  externalSource: 'rapiz' | null;
  usage: Usage | null;
  /** Reminder keys already turned into follow-ups (`<kind>:<date>` → ISO time). */
  remindersSent: Record<string, string>;
}

export type PlanRecord = Omit<SaasPlanDto, 'archived'> & { archivedAt: string | null };

export interface HistoryRecord extends Omit<SaasSubscriptionHistoryEntry, 'changedAt'> {
  subscriptionId: string;
  contactId: string;
  actorUserId: string | null;
  changedAt: string;
}

/** A platform account linked in Rapiz HQ, and the last applied event per kind (ordering). */
export interface HqLinkRecord {
  accountId: string;
  contactId: string;
  /** Event kind (or reminder / upsell key) → `occurredAt` of the last one applied. */
  applied: Record<string, string>;
}

export interface SaasActor {
  userId: string | null;
  name: string | null;
}

export interface SaasTx {
  /** Serializes writers of one key until the transaction ends. */
  lockKey(key: string): Promise<void>;
  findSubscription(contactId: string, lock?: boolean): Promise<SubscriptionRecord | null>;
  findSubscriptionByExternalRef(ref: string, lock?: boolean): Promise<SubscriptionRecord | null>;
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

  /** Position, then name; archived ones too with `withArchived`. */
  listPlans(withArchived: boolean): Promise<PlanRecord[]>;
  findPlan(id: string, lock?: boolean): Promise<PlanRecord | null>;
  /** CONFLICT when a live plan already has the name. */
  insertPlan(plan: PlanRecord): Promise<void>;
  updatePlan(plan: PlanRecord): Promise<void>;

  insertHistory(entry: HistoryRecord): Promise<void>;
  /** Newest first, at most 200. */
  listHistory(subscriptionId: string): Promise<HistoryRecord[]>;

  findHqLink(accountId: string, lock?: boolean): Promise<HqLinkRecord | null>;
  saveHqLink(link: HqLinkRecord): Promise<void>;
  /** Every account linked in this (HQ) business. */
  listHqLinks(): Promise<HqLinkRecord[]>;

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
