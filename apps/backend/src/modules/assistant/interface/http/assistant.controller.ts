import {
  AssistantLearningQuery,
  AssistantThreadListQuery,
  CreateAssistantSkillRequest,
  CreateAssistantThreadRequest,
  SendAssistantMessageRequest,
  UpdateAssistantSkillRequest,
  UpdateAssistantThreadRequest,
  type AssistantLearningFeed,
  type AssistantMemoryDto,
  type AssistantMessageList,
  type AssistantProposalDto,
  type AssistantProposalList,
  type AssistantRunDto,
  type AssistantSkillDto,
  type AssistantSkillEventList,
  type AssistantSkillList,
  type AssistantThreadDto,
  type AssistantThreadList,
  type SendAssistantMessageResponse,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

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
    @Headers('authorization') authorization: string,
  ): Promise<SendAssistantMessageResponse> {
    // The caller's own bearer token, for route tools during this turn only (ruling 1b-R2).
    // The display name is read lazily, only if the turn compacts the thread.
    const displayName = user.displayName;
    return this.facade.sendMessage(
      { ...actor(user, ws), ...(displayName ? { displayName } : {}) },
      threadId,
      body,
      authorization,
    );
  }

  @Get('threads/:threadId/proposals')
  listProposals(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('threadId') threadId: string,
  ): Promise<AssistantProposalList> {
    return this.facade.listProposals(actor(user, ws), threadId);
  }

  @Post('proposals/:proposalId/approve')
  @HttpCode(200)
  approveProposal(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('proposalId') proposalId: string,
    @Headers('authorization') authorization: string,
  ): Promise<AssistantProposalDto> {
    // Runs with the approver's own session, never a stored one.
    return this.facade.approveProposal(actor(user, ws), proposalId, authorization);
  }

  @Post('proposals/:proposalId/reject')
  @HttpCode(200)
  rejectProposal(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('proposalId') proposalId: string,
  ): Promise<AssistantProposalDto> {
    return this.facade.rejectProposal(actor(user, ws), proposalId);
  }

  @Get('runs/:runId')
  getRun(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('runId') runId: string,
  ): Promise<AssistantRunDto> {
    return this.facade.getRun(actor(user, ws), runId);
  }

  @Get('learning')
  getLearning(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(AssistantLearningQuery)) query: AssistantLearningQuery,
  ): Promise<AssistantLearningFeed> {
    return this.facade.getLearning(actor(user, ws), query);
  }

  @Get('memory')
  getMemory(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
  ): Promise<AssistantMemoryDto> {
    return this.facade.getMemory(actor(user, ws));
  }

  @Delete('memory/:store/entries/:entryId')
  @HttpCode(200)
  deleteMemoryEntry(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('store') store: string,
    @Param('entryId') entryId: string,
  ): Promise<AssistantMemoryDto> {
    return this.facade.deleteMemoryEntry(actor(user, ws), store, entryId);
  }

  // ─── Skills (1c) ───

  @Get('skills')
  listSkills(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
  ): Promise<AssistantSkillList> {
    return this.facade.listSkills(actor(user, ws));
  }

  @Get('skills/:skillRef')
  getSkill(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('skillRef') skillRef: string,
  ): Promise<AssistantSkillDto> {
    return this.facade.getSkill(actor(user, ws), skillRef);
  }

  @Post('skills')
  @HttpCode(201)
  createSkill(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(CreateAssistantSkillRequest)) body: CreateAssistantSkillRequest,
  ): Promise<AssistantSkillDto> {
    return this.facade.createSkill(actor(user, ws), body);
  }

  @Patch('skills/:skillId')
  updateSkill(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('skillId') skillId: string,
    @Body(new ZodValidationPipe(UpdateAssistantSkillRequest)) body: UpdateAssistantSkillRequest,
  ): Promise<AssistantSkillDto> {
    return this.facade.updateSkill(actor(user, ws), skillId, body);
  }

  @Delete('skills/:skillId')
  @HttpCode(204)
  async deleteSkill(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('skillId') skillId: string,
  ): Promise<void> {
    await this.facade.deleteSkill(actor(user, ws), skillId);
  }

  @Post('skills/:skillId/approve')
  @HttpCode(200)
  approveSkill(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('skillId') skillId: string,
  ): Promise<AssistantSkillDto> {
    return this.facade.approveSkill(actor(user, ws), skillId);
  }

  @Post('skills/:skillId/reject')
  @HttpCode(200)
  rejectSkill(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('skillId') skillId: string,
  ): Promise<AssistantSkillDto> {
    return this.facade.rejectSkill(actor(user, ws), skillId);
  }

  @Post('skills/:skillId/archive')
  @HttpCode(200)
  archiveSkill(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('skillId') skillId: string,
  ): Promise<AssistantSkillDto> {
    return this.facade.archiveSkill(actor(user, ws), skillId);
  }

  @Post('skills/:skillId/restore')
  @HttpCode(200)
  restoreSkill(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('skillId') skillId: string,
  ): Promise<AssistantSkillDto> {
    return this.facade.restoreSkill(actor(user, ws), skillId);
  }

  @Post('skills/platform/:name/shadow')
  @HttpCode(201)
  shadowSkill(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('name') name: string,
  ): Promise<AssistantSkillDto> {
    return this.facade.shadowSkill(actor(user, ws), name);
  }

  @Get('skills/:skillId/events')
  listSkillEvents(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('skillId') skillId: string,
  ): Promise<AssistantSkillEventList> {
    return this.facade.listSkillEvents(actor(user, ws), skillId);
  }

  @Post('skill-events/:eventId/undo')
  @HttpCode(200)
  undoSkillEvent(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('eventId') eventId: string,
  ): Promise<AssistantSkillDto> {
    return this.facade.undoSkillEvent(actor(user, ws), eventId);
  }
}
