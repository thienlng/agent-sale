import type { WorkspaceDto } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type {
  GivenRole,
  MemberActor,
  WorkspaceFacade,
  WorkspaceMember,
  WorkspaceMembership,
} from '../api/workspace.facade.js';
import { CreateWorkspaceHandler } from './commands/create-workspace/create-workspace.handler.js';
import { ManageMembersHandler } from './commands/manage-members/manage-members.handler.js';
import { WORKSPACE_DIRECTORY, type WorkspaceDirectory } from './ports/workspace-directory.js';
import { GetWorkspaceHandler } from './queries/get-workspace/get-workspace.handler.js';

/** Facade implementation: delegates to handlers/ports; no logic of its own. */
@Injectable()
export class WorkspaceFacadeImpl implements WorkspaceFacade {
  constructor(
    @Inject(CreateWorkspaceHandler) private readonly create: CreateWorkspaceHandler,
    @Inject(GetWorkspaceHandler) private readonly get: GetWorkspaceHandler,
    @Inject(WORKSPACE_DIRECTORY) private readonly directory: WorkspaceDirectory,
    @Inject(ManageMembersHandler) private readonly members: ManageMembersHandler,
  ) {}

  getById(workspaceId: WorkspaceId): Promise<WorkspaceDto> {
    return this.get.execute(workspaceId);
  }

  createWorkspace(input: {
    name: string;
    industry: string;
    ownerUserId: UserId;
    accountId?: string | undefined;
    timezone?: string | undefined;
  }): Promise<WorkspaceDto> {
    return this.create.execute(input);
  }

  findMembership(workspaceId: WorkspaceId, userId: UserId): Promise<WorkspaceMembership | null> {
    return this.directory.findMembership(workspaceId, userId);
  }

  listMemberships(userId: UserId): Promise<WorkspaceMembership[]> {
    return this.directory.listMemberships(userId);
  }

  listMembers(
    workspaceId: WorkspaceId,
    opts?: { includeRemoved?: boolean },
  ): Promise<WorkspaceMember[]> {
    return this.directory.listMembers(workspaceId, opts?.includeRemoved ?? false);
  }

  async joinMember(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: GivenRole,
    opts: { seatLimit: number | null; actor: MemberActor },
  ): Promise<void> {
    await this.members.join(workspaceId, userId, role, opts.seatLimit, opts.actor);
  }

  async changeMemberRole(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: GivenRole,
    actor: MemberActor,
  ): Promise<void> {
    await this.members.changeRole(workspaceId, userId, role, actor);
  }

  async removeMember(workspaceId: WorkspaceId, userId: UserId, actor: MemberActor): Promise<void> {
    await this.members.remove(workspaceId, userId, actor);
  }
}
