import type { WorkspaceDto } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type {
  WorkspaceFacade,
  WorkspaceMember,
  WorkspaceMembership,
} from '../api/workspace.facade.js';
import { CreateWorkspaceHandler } from './commands/create-workspace/create-workspace.handler.js';
import { WORKSPACE_DIRECTORY, type WorkspaceDirectory } from './ports/workspace-directory.js';
import { GetWorkspaceHandler } from './queries/get-workspace/get-workspace.handler.js';

/** Facade implementation: delegates to handlers/ports; no logic of its own. */
@Injectable()
export class WorkspaceFacadeImpl implements WorkspaceFacade {
  constructor(
    @Inject(CreateWorkspaceHandler) private readonly create: CreateWorkspaceHandler,
    @Inject(GetWorkspaceHandler) private readonly get: GetWorkspaceHandler,
    @Inject(WORKSPACE_DIRECTORY) private readonly directory: WorkspaceDirectory,
  ) {}

  getById(workspaceId: WorkspaceId): Promise<WorkspaceDto> {
    return this.get.execute(workspaceId);
  }

  createWorkspace(input: {
    name: string;
    industry: string;
    ownerUserId: UserId;
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

  listMembers(workspaceId: WorkspaceId): Promise<WorkspaceMember[]> {
    return this.directory.listMembers(workspaceId);
  }
}
