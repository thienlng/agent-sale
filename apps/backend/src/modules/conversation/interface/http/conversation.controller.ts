import {
  ConversationListQuery,
  SendInboxMessageRequest,
  UpdateConversationRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CurrentWorkspace,
  CurrentUser,
  WorkspaceScoped,
  type AuthState,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ConversationFacadeImpl } from '../../application/conversation.facade.impl.js';
const idPipe = new ZodValidationPipe(z.uuid());
@WorkspaceScoped()
@Controller('conversations')
export class ConversationController {
  constructor(@Inject(ConversationFacadeImpl) private readonly inbox: ConversationFacadeImpl) {}
  @Get() list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(ConversationListQuery)) query: ConversationListQuery,
  ) {
    return this.inbox.list(ws, query);
  }
  @Get(':id') get(@CurrentWorkspace() ws: WorkspaceId, @Param('id', idPipe) id: string) {
    return this.inbox.get(ws, id);
  }
  @Patch(':id') update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateConversationRequest)) input: UpdateConversationRequest,
  ) {
    return this.inbox.update(ws, id, input, user.userId);
  }
  @Post(':id/messages') send(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SendInboxMessageRequest)) input: SendInboxMessageRequest,
  ) {
    return this.inbox.send(ws, id, input, user.userId);
  }
}
