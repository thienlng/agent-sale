import {
  type RefreshTodayResponse,
  type ReplyDraftResponse,
  roleCan,
  type TodayResponse,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ReplyDraftService } from '../../application/reply-draft.service.js';
import { TodayQuery } from '../../application/today.query.js';

const idPipe = new ZodValidationPipe(z.uuid());
/** Sales and care (no `contacts.view_all`) see their own and unassigned customers. */
const viewer = (u: AuthState) => ({
  userId: u.userId,
  viewAll: roleCan(u.role, 'contacts.view_all'),
});

/** The Today screen (spec 2026-11-11 §5). Every member reads it; acting needs `contacts.edit`. */
@WorkspaceScoped()
@Controller('today')
export class TodayController {
  constructor(@Inject(TodayQuery) private readonly today: TodayQuery) {}

  @RequireCapability('contacts.view')
  @Get()
  get(@CurrentWorkspace() ws: WorkspaceId, @CurrentUser() u: AuthState): Promise<TodayResponse> {
    return this.today.today(ws, viewer(u));
  }

  @RequireCapability('contacts.edit')
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() u: AuthState,
  ): Promise<RefreshTodayResponse> {
    return this.today.refresh(ws, viewer(u));
  }

  @RequireCapability('contacts.view')
  @Post('items/:conversationId/dismiss')
  @HttpCode(204)
  async dismiss(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() u: AuthState,
    @Param('conversationId', idPipe) id: string,
  ): Promise<void> {
    await this.today.dismiss(ws, viewer(u), id);
  }
}

/** "Soạn trả lời": a reply draft for the member to edit and send; never sent by itself. */
@WorkspaceScoped()
@Controller('conversations')
export class ReplyDraftController {
  constructor(@Inject(ReplyDraftService) private readonly drafts: ReplyDraftService) {}

  @RequireCapability('contacts.edit')
  @Post(':id/reply-draft')
  @HttpCode(200)
  draft(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() u: AuthState,
    @Param('id', idPipe) id: string,
  ): Promise<ReplyDraftResponse> {
    return this.drafts.draft(ws, viewer(u), id);
  }
}
