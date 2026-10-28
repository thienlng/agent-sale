import type { UserId } from '@agent-sales/shared';

export interface CreateWorkspaceCommand {
  name: string;
  industry: string;
  ownerUserId: UserId;
  /** Account that owns the business; omitted → resolved by the account module (ADR-012 §3). */
  accountId?: string | undefined;
  timezone?: string | undefined;
}
