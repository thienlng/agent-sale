import { PlaygroundRequest, type PlaygroundResponse } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';

import { CurrentWorkspace, WorkspaceScoped } from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { AI_FACADE, type AiFacade } from '../../api/ai.facade.js';

/** Thin controller: POST /bots/{botId}/playground. */
@WorkspaceScoped()
@Controller('bots')
export class AiController {
  constructor(@Inject(AI_FACADE) private readonly ai: AiFacade) {}

  @Post(':botId/playground')
  @HttpCode(200)
  playground(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(PlaygroundRequest)) body: PlaygroundRequest,
  ): Promise<PlaygroundResponse> {
    return this.ai.playground(ws, botId, body);
  }
}
