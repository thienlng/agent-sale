import type { UserId } from '@agent-sales/shared';

export interface CreateWorkspaceCommand {
  name: string;
  industry: string;
  ownerUserId: UserId;
  timezone?: string | undefined;
}
