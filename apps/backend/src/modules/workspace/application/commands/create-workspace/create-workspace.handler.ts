import type { WorkspaceCreatedV1, WorkspaceDto } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { Workspace } from '../../../domain/workspace.js';
import { toWorkspaceDto } from '../../mappers.js';
import { WORKSPACE_UOW, type WorkspaceUnitOfWork } from '../../ports/workspace-unit-of-work.js';
import type { CreateWorkspaceCommand } from './create-workspace.command.js';

/**
 * Command handler = one use case. Shape: construct/load aggregate → act →
 * persist + publish integration events inside ONE unit of work → return DTO.
 */
@Injectable()
export class CreateWorkspaceHandler {
  constructor(@Inject(WORKSPACE_UOW) private readonly uow: WorkspaceUnitOfWork) {}

  async execute(command: CreateWorkspaceCommand): Promise<WorkspaceDto> {
    const workspace = Workspace.create(command);
    await this.uow.run(workspace.id, async ({ workspaces, members, events }) => {
      await workspaces.save(workspace);
      await members.add({
        id: newId(),
        workspaceId: workspace.id,
        userId: command.ownerUserId,
        role: 'owner',
        status: 'active',
      });
      for (const e of workspace.pullEvents()) {
        if (e.name === 'workspace.created') {
          const integration: WorkspaceCreatedV1 = {
            type: 'workspace.workspace.created.v1',
            workspaceId: workspace.id,
            ownerUserId: command.ownerUserId,
            industry: command.industry.trim(),
            occurredAt: e.occurredAt.toISOString(),
          };
          await events.publish(workspace.id, { type: 'workspace', id: workspace.id }, integration);
        }
      }
    });
    return toWorkspaceDto(workspace);
  }
}
