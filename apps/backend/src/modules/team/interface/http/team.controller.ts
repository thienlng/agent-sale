import {
  AcceptInvitationRequest,
  ChangeMemberRoleRequest,
  CreateInvitationRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { TeamService } from '../../application/team.service.js';

const actor = (u: AuthState) => ({ userId: u.userId, role: u.role });

/** Thin controller: members, invitations and invitation links. */
@Controller()
export class TeamController {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  @Get('members')
  @WorkspaceScoped()
  async members(@CurrentWorkspace() ws: WorkspaceId, @CurrentUser() user: AuthState) {
    return { data: await this.team.listMembers(ws, actor(user)) };
  }

  @Patch('members/:userId')
  @WorkspaceScoped()
  @RequireCapability('members.manage')
  changeRole(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('userId') target: string,
    @Body(new ZodValidationPipe(ChangeMemberRoleRequest))
    body: z.infer<typeof ChangeMemberRoleRequest>,
  ) {
    return this.team.changeRole(ws, target, body.role, actor(user));
  }

  @Post('members/:userId/remove')
  @HttpCode(200)
  @WorkspaceScoped()
  @RequireCapability('members.manage')
  remove(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('userId') target: string,
  ) {
    return this.team.remove(ws, target, actor(user));
  }

  @Get('invitations')
  @WorkspaceScoped()
  @RequireCapability('members.manage')
  async invitations(@CurrentWorkspace() ws: WorkspaceId) {
    return { data: await this.team.listInvitations(ws) };
  }

  @Post('invitations')
  @HttpCode(201)
  @WorkspaceScoped()
  @RequireCapability('members.manage')
  invite(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateInvitationRequest)) body: unknown,
  ) {
    return this.team.invite(ws, body, actor(user));
  }

  @Post('invitations/:invitationId/revoke')
  @HttpCode(200)
  @WorkspaceScoped()
  @RequireCapability('members.manage')
  revoke(@CurrentWorkspace() ws: WorkspaceId, @Param('invitationId') id: string) {
    return this.team.revoke(ws, id);
  }

  // Signed in, not a member yet: no @WorkspaceScoped. `accept` before `:token`.
  @Post('invitation-links/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(AcceptInvitationRequest))
    body: z.infer<typeof AcceptInvitationRequest>,
  ) {
    return this.team.accept(body.token, user.userId);
  }

  @Get('invitation-links/:token')
  preview(@CurrentUser() user: AuthState, @Param('token') token: string) {
    return this.team.preview(token, user.userId);
  }
}
