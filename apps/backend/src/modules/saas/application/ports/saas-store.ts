import type {
  SaasRequestDto,
  SaasRequestKind,
  SaasRequestStatus,
  SaasStage,
  SaasSubscriptionDto,
  SaasSummary,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

export interface StoredRequest extends SaasRequestDto {
  clientRequestId: string;
  fingerprint: string;
}
export type SubscriptionRecord = Omit<SaasSubscriptionDto, 'contactName'>;
export interface SaasActor {
  userId: string | null;
  name: string | null;
}

export interface SaasTx {
  /** Serializes writers of one idempotency key until the transaction ends. */
  lockKey(key: string): Promise<void>;
  findRequest(id: string, lock?: boolean): Promise<StoredRequest | null>;
  findRequestByKey(clientRequestId: string, lock?: boolean): Promise<StoredRequest | null>;
  /** Newest first; returns up to 101 rows so the caller can tell whether more exist. */
  listRequests(filter: {
    status?: SaasRequestStatus | undefined;
    kind?: SaasRequestKind | undefined;
    offset: number;
  }): Promise<StoredRequest[]>;
  insertRequest(row: StoredRequest): Promise<void>;
  updateRequest(row: StoredRequest): Promise<void>;
  findSubscription(contactId: string, lock?: boolean): Promise<SubscriptionRecord | null>;
  /** Most recently updated first; up to 101 rows. */
  listSubscriptions(filter: {
    stage?: SaasStage | undefined;
    offset: number;
  }): Promise<SubscriptionRecord[]>;
  insertSubscription(row: SubscriptionRecord): Promise<void>;
  updateSubscription(row: SubscriptionRecord): Promise<void>;
  /** `today`..`soon` (inclusive, yyyy-mm-dd) bounds "trials ending soon". */
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
