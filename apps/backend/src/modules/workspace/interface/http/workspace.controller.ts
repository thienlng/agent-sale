import {
  CreateWorkspaceRequest,
  type DeletedBusinessDto,
  type DeletedBusinessList,
  RequestBusinessDeletionRequest,
  type WorkspaceDto,
} from '@agent-sales/contracts';
import { type WorkspaceId, workspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';

import { ApiError } from '../../../../common/http/api-error.js';
import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../api/workspace.facade.js';
import { BusinessDeletionService } from '../../application/business-deletion.service.js';

function idOf(raw: string): WorkspaceId {
  try {
    return workspaceId(raw);
  } catch {
    // An id that cannot exist is the same as one the user has no access to.
    throw new ApiError('NOT_FOUND', 'Workspace not found');
  }
}

/** Thin controller: validate → facade → DTO. Auth/membership enforced by the global guard. */
@Controller('workspaces')
export class WorkspaceController {
  constructor(
    @Inject(WORKSPACE_FACADE) private readonly facade: WorkspaceFacade,
    @Inject(BusinessDeletionService) private readonly deletion: BusinessDeletionService,
  ) {}

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

  /**
   * Not workspace-scoped: a deleted business no longer passes the workspace guard, so delete and
   * restore name it in the path and check the owner themselves (ADR-033).
   */
  @Get('deleted')
  async deleted(@CurrentUser() user: AuthState): Promise<DeletedBusinessList> {
    return { data: await this.deletion.listDeleted(user.userId) };
  }

  @Post(':workspaceId/deletion')
  @HttpCode(200)
  async requestDeletion(
    @CurrentUser() user: AuthState,
    @Param('workspaceId') raw: string,
    @Body(new ZodValidationPipe(RequestBusinessDeletionRequest))
    body: RequestBusinessDeletionRequest,
  ): Promise<DeletedBusinessDto> {
    return this.deletion.requestDeletion(
      idOf(raw),
      { userId: user.userId, name: (await user.displayName?.()) ?? null },
      body.confirmName,
    );
  }

  @Post(':workspaceId/restore')
  @HttpCode(200)
  async restore(
    @CurrentUser() user: AuthState,
    @Param('workspaceId') raw: string,
  ): Promise<WorkspaceDto> {
    return this.deletion.restore(idOf(raw), {
      userId: user.userId,
      name: (await user.displayName?.()) ?? null,
    });
  }
}
