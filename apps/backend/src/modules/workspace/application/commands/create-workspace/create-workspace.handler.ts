import type { WorkspaceCreatedV1, WorkspaceDto } from '@agent-sales/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { Workspace } from '../../../domain/workspace.js';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../../../domain/ports/workspace.repository.js';
import { EVENT_PUBLISHER, type EventPublisher } from '../../ports/event-publisher.js';
import { toWorkspaceDto } from '../../mappers.js';
import type { CreateWorkspaceCommand } from './create-workspace.command.js';

/**
 * Command handler = one use case. Shape: load/construct aggregate → act →
 * persist → publish integration events (outbox) → return DTO.
 */
@Injectable()
export class CreateWorkspaceHandler {
  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly repo: WorkspaceRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async execute(command: CreateWorkspaceCommand): Promise<WorkspaceDto> {
    const workspace = Workspace.create(command);
    await this.repo.save(workspace);
    for (const e of workspace.pullEvents()) {
      if (e.name === 'workspace.created') {
        const integration: WorkspaceCreatedV1 = {
          type: 'workspace.workspace.created.v1',
          workspaceId: workspace.id,
          ownerUserId: command.ownerUserId,
          industry: command.industry.trim(),
          occurredAt: e.occurredAt.toISOString(),
        };
        await this.events.publish(workspace.id, integration);
      }
    }
    return toWorkspaceDto(workspace);
  }
}
