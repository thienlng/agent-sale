import type { WorkspaceDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WorkspaceNotFoundError } from '../../../domain/workspace.errors.js';
import { toWorkspaceDto } from '../../mappers.js';
import { WORKSPACE_UOW, type WorkspaceUnitOfWork } from '../../ports/workspace-unit-of-work.js';

@Injectable()
export class GetWorkspaceHandler {
  constructor(@Inject(WORKSPACE_UOW) private readonly uow: WorkspaceUnitOfWork) {}

  async execute(id: WorkspaceId): Promise<WorkspaceDto> {
    const ws = await this.uow.run(id, ({ workspaces }) => workspaces.findById(id));
    if (!ws) throw new WorkspaceNotFoundError(id);
    return toWorkspaceDto(ws);
  }

  /** The account owning the business; null before the account backfill linked it. */
  async accountOf(id: WorkspaceId): Promise<string | null> {
    const ws = await this.uow.run(id, ({ workspaces }) => workspaces.findById(id));
    if (!ws) throw new WorkspaceNotFoundError(id);
    return ws.snapshot().accountId;
  }
}
