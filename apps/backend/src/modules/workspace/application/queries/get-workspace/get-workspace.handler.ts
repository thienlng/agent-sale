import type { WorkspaceDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WorkspaceNotFoundError } from '../../../domain/workspace.errors.js';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../../../domain/ports/workspace.repository.js';
import { toWorkspaceDto } from '../../mappers.js';

@Injectable()
export class GetWorkspaceHandler {
  constructor(@Inject(WORKSPACE_REPOSITORY) private readonly repo: WorkspaceRepository) {}

  async execute(id: WorkspaceId): Promise<WorkspaceDto> {
    const ws = await this.repo.findById(id);
    if (!ws) throw new WorkspaceNotFoundError(id);
    return toWorkspaceDto(ws);
  }
}
