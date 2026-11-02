import type { UserId, WorkspaceId } from '@agent-sales/shared';

/**
 * Who the assistant works for: one active owner inside one account (ADR-022). `businessId` is
 * the business the request came from; assistant data belongs to the account and the owner.
 */
export interface OwnerScope {
  accountId: string;
  ownerUserId: UserId;
  businessId: WorkspaceId;
}
