import {
  AssistantThreadListQuery,
  CreateAssistantThreadRequest,
  SendAssistantMessageRequest,
  UpdateAssistantThreadRequest,
  type AssistantMessageList,
  type AssistantRunDto,
  type AssistantThreadDto,
  type AssistantThreadList,
  type SendAssistantMessageResponse,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import {
  ASSISTANT_FACADE,
  type AssistantActor,
  type AssistantFacade,
} from '../../api/assistant.facade.js';

const actor = (user: AuthState, businessId: WorkspaceId): AssistantActor => ({
  userId: user.userId,
  businessId,
});

/**
 * Thin controller for the owner assistant. The facade answers 403 FORBIDDEN unless the caller
 * owns the account of the current business, and 404 NOT_FOUND for another owner's thread/run.
 */
@WorkspaceScoped()
@Controller('assistant')
export class AssistantController {
  constructor(@Inject(ASSISTANT_FACADE) private readonly facade: AssistantFacade) {}

  @Get('threads')
  listThreads(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(AssistantThreadListQuery)) query: AssistantThreadListQuery,
  ): Promise<AssistantThreadList> {
    return this.facade.listThreads(actor(user, ws), query);
  }

  @Post('threads')
  @HttpCode(201)
  async createThread(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(CreateAssistantThreadRequest)) body: CreateAssistantThreadRequest,
  ): Promise<AssistantThreadDto> {
    const ownerName = (await user.displayName?.()) ?? null;
    return this.facade.createThread({ ...actor(user, ws), ownerName }, body);
  }

  @Patch('threads/:threadId')
  updateThread(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('threadId') threadId: string,
    @Body(new ZodValidationPipe(UpdateAssistantThreadRequest)) body: UpdateAssistantThreadRequest,
  ): Promise<AssistantThreadDto> {
    return this.facade.updateThread(actor(user, ws), threadId, body);
  }

  @Get('threads/:threadId/messages')
  listMessages(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('threadId') threadId: string,
  ): Promise<AssistantMessageList> {
    return this.facade.listMessages(actor(user, ws), threadId);
  }

  @Post('threads/:threadId/messages')
  @HttpCode(200)
  sendMessage(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('threadId') threadId: string,
    @Body(new ZodValidationPipe(SendAssistantMessageRequest)) body: SendAssistantMessageRequest,
  ): Promise<SendAssistantMessageResponse> {
    return this.facade.sendMessage(actor(user, ws), threadId, body);
  }

  @Get('runs/:runId')
  getRun(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('runId') runId: string,
  ): Promise<AssistantRunDto> {
    return this.facade.getRun(actor(user, ws), runId);
  }
}
