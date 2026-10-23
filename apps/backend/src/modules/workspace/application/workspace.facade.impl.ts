import type { WorkspaceDto } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { WorkspaceFacade } from '../api/workspace.facade.js';
import { CreateWorkspaceHandler } from './commands/create-workspace/create-workspace.handler.js';
import { GetWorkspaceHandler } from './queries/get-workspace/get-workspace.handler.js';

/** Facade implementation: delegates to handlers; no logic of its own. */
@Injectable()
export class WorkspaceFacadeImpl implements WorkspaceFacade {
  constructor(
    @Inject(CreateWorkspaceHandler) private readonly create: CreateWorkspaceHandler,
    @Inject(GetWorkspaceHandler) private readonly get: GetWorkspaceHandler,
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
}
