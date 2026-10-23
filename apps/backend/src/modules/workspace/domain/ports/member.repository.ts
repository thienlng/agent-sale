import type { UserId, WorkspaceId } from '@agent-sales/shared';

export type MemberRole = 'owner' | 'admin' | 'sales_manager' | 'sale' | 'bot_editor' | 'accountant';

export interface Membership {
  id: string;
  workspaceId: WorkspaceId;
  userId: UserId;
  role: MemberRole;
  status: 'active' | 'invited' | 'disabled';
}

/** Port implemented in infrastructure/persistence. Bound to one unit of work. */
export interface MemberRepository {
  add(membership: Membership): Promise<void>;
  find(workspaceId: WorkspaceId, userId: UserId): Promise<Membership | null>;
}
