import type { UserId, WorkspaceId } from '@agent-sales/shared';

/**
 * Who the assistant works for: one active owner inside one account (ADR-023). `businessId` is
 * the business the request came from; assistant data belongs to the account and the owner.
 * `businessIds` are the account's businesses the owner is an active member of (sorted); a
 * `business:<id>` memory store, for instance, must name one of them.
 */
export interface OwnerScope {
  accountId: string;
  ownerUserId: UserId;
  businessId: WorkspaceId;
  businessIds: WorkspaceId[];
}
