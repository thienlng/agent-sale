import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  FacebookId,
  FanpageSettings,
  FanpageManualAction,
  FanpageCommentListQuery,
  FanpageCommentPostsQuery,
} from '@agent-sales/contracts';
import { type WorkspaceId } from '@agent-sales/shared';
import {
  CurrentWorkspace,
  WorkspaceScoped,
  CurrentUser,
  RequireCapability,
  type AuthState,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { FANPAGE_FACADE, type FanpageFacade } from '../../api/fanpage.facade.js';
const uuid = new ZodValidationPipe(z.uuid());
const facebookId = new ZodValidationPipe(FacebookId);
@Controller('channels/:id/fanpage')
export class FanpageController {
  constructor(@Inject(FANPAGE_FACADE) private readonly pages: FanpageFacade) {}
  @WorkspaceScoped()
  @Get('settings')
  settings(@CurrentWorkspace() ws: WorkspaceId, @Param('id', uuid) id: string) {
    return this.pages.settings(ws, id);
  }
  @WorkspaceScoped()
  @RequireCapability('settings.manage')
  @Patch('settings')
  save(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(FanpageSettings)) body: FanpageSettings,
  ) {
    return this.pages.saveSettings(ws, id, body);
  }
  @WorkspaceScoped()
  @Get('posts')
  async posts(@CurrentWorkspace() ws: WorkspaceId, @Param('id', uuid) id: string) {
    return { data: await this.pages.posts(ws, id) };
  }
  @WorkspaceScoped()
  @Get('comments')
  comments(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(FanpageCommentListQuery)) query: FanpageCommentListQuery,
  ) {
    return this.pages.comments(ws, id, query);
  }
  @WorkspaceScoped()
  @Get('comment-posts')
  commentPosts(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(FanpageCommentPostsQuery)) query: FanpageCommentPostsQuery,
  ) {
    return this.pages.commentPosts(ws, id, query);
  }
  // Reads never pause automation, mark review or reorder the list; only actions do.
  @WorkspaceScoped()
  @Get('comments/:commentId')
  comment(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', uuid) id: string,
    @Param('commentId', facebookId) commentId: string,
  ) {
    return this.pages.comment(ws, id, commentId);
  }
  @WorkspaceScoped()
  @Get('comments/:commentId/source')
  source(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', uuid) id: string,
    @Param('commentId', facebookId) commentId: string,
  ) {
    return this.pages.source(ws, id, commentId);
  }
  // Same write capability as the inbox: view-only roles cannot reply or moderate, even directly.
  @WorkspaceScoped()
  @RequireCapability('contacts.edit')
  @Post('comments/:commentId/actions')
  async act(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', uuid) id: string,
    @Param('commentId', facebookId) commentId: string,
    @Body(new ZodValidationPipe(FanpageManualAction)) body: FanpageManualAction,
  ) {
    // Actor control is recorded by the manual flag/reason; further automatic work is paused.
    const action = await this.pages.act(ws, id, commentId, {
      kind: body.kind,
      text: body.text,
      key: body.requestId,
      ...(body.version ? { version: body.version } : {}),
      confirmPublicContact: body.confirmPublicContact,
      actorId: user.userId,
      reason: 'Manual staff action',
      automatic: false,
    });
    return { action };
  }
}
