import {
  AssistantMessageFeedbackRequest,
  UpdateAssistantSettingsRequest,
  type AcceptAssistantSuggestionResponse,
  type AssistantSettingsDto,
  type AssistantSuggestionDto,
  type AssistantSuggestionList,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';

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
 * The owner's assistant settings, answer feedback and suggestion cards (1c). Same guard as
 * `AssistantController`: owners only (403), another owner's message or suggestion is 404.
 */
@WorkspaceScoped()
@Controller('assistant')
export class AssistantSettingsController {
  constructor(@Inject(ASSISTANT_FACADE) private readonly facade: AssistantFacade) {}

  @Get('settings')
  getSettings(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
  ): Promise<AssistantSettingsDto> {
    return this.facade.getSettings(actor(user, ws));
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(UpdateAssistantSettingsRequest))
    body: UpdateAssistantSettingsRequest,
  ): Promise<AssistantSettingsDto> {
    return this.facade.updateSettings(actor(user, ws), body);
  }

  @Post('messages/:messageId/feedback')
  @HttpCode(204)
  async setFeedback(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(AssistantMessageFeedbackRequest))
    body: AssistantMessageFeedbackRequest,
  ): Promise<void> {
    await this.facade.setMessageFeedback(actor(user, ws), messageId, body);
  }

  @Get('suggestions')
  listSuggestions(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
  ): Promise<AssistantSuggestionList> {
    return this.facade.listSuggestions(actor(user, ws));
  }

  @Post('suggestions/:suggestionId/accept')
  @HttpCode(200)
  acceptSuggestion(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('suggestionId') suggestionId: string,
  ): Promise<AcceptAssistantSuggestionResponse> {
    return this.facade.acceptSuggestion(actor(user, ws), suggestionId);
  }

  @Post('suggestions/:suggestionId/dismiss')
  @HttpCode(200)
  dismissSuggestion(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('suggestionId') suggestionId: string,
  ): Promise<AssistantSuggestionDto> {
    return this.facade.dismissSuggestion(actor(user, ws), suggestionId);
  }
}
