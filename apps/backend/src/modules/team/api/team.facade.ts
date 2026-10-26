import type { MemberDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the team module: members with names and emails. */
export interface TeamFacade {
  listMembers(
    workspaceId: WorkspaceId,
    actor: { userId: string; role: string | undefined },
  ): Promise<MemberDto[]>;
}

export const TEAM_FACADE = Symbol('TEAM_FACADE');
