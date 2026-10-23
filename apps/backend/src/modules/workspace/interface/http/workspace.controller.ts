import { CreateWorkspaceRequest, type WorkspaceDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../api/workspace.facade.js';

/** Thin controller: validate → facade → DTO. Auth/membership enforced by the global guard. */
@Controller('workspaces')
export class WorkspaceController {
  constructor(@Inject(WORKSPACE_FACADE) private readonly facade: WorkspaceFacade) {}

  @Get('current')
  @WorkspaceScoped()
  current(@CurrentWorkspace() workspaceId: WorkspaceId): Promise<WorkspaceDto> {
    return this.facade.getById(workspaceId);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateWorkspaceRequest)) body: CreateWorkspaceRequest,
  ): Promise<WorkspaceDto> {
    return this.facade.createWorkspace({ ...body, ownerUserId: user.userId });
  }
}
