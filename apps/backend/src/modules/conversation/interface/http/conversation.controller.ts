import {
  AddConversationNoteRequest,
  AssignConversationTagRequest,
  BulkConversationRequest,
  ConversationListQuery,
  SendInboxMessageRequest,
  UpdateConversationRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
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
    @CurrentUser() user: AuthState,
    @Query(new ZodValidationPipe(ConversationListQuery)) query: ConversationListQuery,
  ) {
    return this.inbox.list(ws, query, user.userId);
  }
  /** Always 200: per-conversation results tell which ids failed. */
  @RequireCapability('contacts.edit')
  @Post('bulk')
  @HttpCode(200)
  bulk(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(BulkConversationRequest)) input: BulkConversationRequest,
  ) {
    return this.inbox.bulk(ws, input, user.userId);
  }
  @Get(':id') get(@CurrentWorkspace() ws: WorkspaceId, @Param('id', idPipe) id: string) {
    return this.inbox.get(ws, id);
  }
  @RequireCapability('contacts.edit')
  @Patch(':id')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateConversationRequest)) input: UpdateConversationRequest,
  ) {
    return this.inbox.update(ws, id, input, user.userId);
  }
  @RequireCapability('contacts.edit')
  @Post(':id/messages')
  send(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SendInboxMessageRequest)) input: SendInboxMessageRequest,
  ) {
    return this.inbox.send(ws, id, input, user.userId);
  }
  @RequireCapability('contacts.edit')
  @Post(':id/read')
  @HttpCode(200)
  read(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', idPipe) id: string,
  ) {
    return this.inbox.markRead(ws, id, user.userId);
  }
  @RequireCapability('contacts.edit')
  @Post(':id/unread')
  @HttpCode(200)
  unread(@CurrentWorkspace() ws: WorkspaceId, @Param('id', idPipe) id: string) {
    return this.inbox.markUnread(ws, id);
  }
  @RequireCapability('contacts.edit')
  @Post(':id/notes')
  addNote(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AddConversationNoteRequest)) input: AddConversationNoteRequest,
  ) {
    return this.inbox.addNote(ws, id, input.text, user.userId);
  }
  @Get(':id/tags')
  async tags(@CurrentWorkspace() ws: WorkspaceId, @Param('id', idPipe) id: string) {
    return { data: await this.inbox.listTags(ws, id) };
  }
  /** 201 when the tag was added, 200 when it was already there (safe to retry). */
  @RequireCapability('contacts.edit')
  @Post(':id/tags')
  async addTag(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AssignConversationTagRequest)) body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { created, assignment } = await this.inbox.addTag(ws, id, body, user.userId);
    void reply.status(created ? 201 : 200);
    return assignment;
  }
}
