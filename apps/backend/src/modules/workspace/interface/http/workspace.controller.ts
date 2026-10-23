import { CreateWorkspaceRequest, type WorkspaceDto } from '@agent-sales/contracts';
import { newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, Inject, Post } from '@nestjs/common';

import { CurrentWorkspace } from '../../../../common/http/workspace-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../api/workspace.facade.js';

/** Thin controller: validate → facade → DTO. No business rules here. */
@Controller('workspaces')
export class WorkspaceController {
  constructor(@Inject(WORKSPACE_FACADE) private readonly facade: WorkspaceFacade) {}

  @Get('current')
  current(@CurrentWorkspace() workspaceId: WorkspaceId): Promise<WorkspaceDto> {
    return this.facade.getById(workspaceId);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateWorkspaceRequest)) body: CreateWorkspaceRequest,
  ): Promise<WorkspaceDto> {
    // TODO(T-003 follow-up): owner comes from the authenticated session, not a fresh id.
    return this.facade.createWorkspace({ ...body, ownerUserId: userId(newId()) });
  }
}
