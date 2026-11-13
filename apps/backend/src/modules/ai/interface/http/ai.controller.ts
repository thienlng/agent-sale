import { PlaygroundRequest, type PlaygroundResponse } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';

import {
  CurrentUser,
  type AuthState,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { AI_FACADE, type AiFacade } from '../../api/ai.facade.js';

/** Thin controller: POST /bots/{botId}/playground. */
@WorkspaceScoped()
@Controller('bots')
export class AiController {
  constructor(@Inject(AI_FACADE) private readonly ai: AiFacade) {}

  @RequireCapability('bots.manage')
  @Post(':botId/playground')
  @HttpCode(200)
  // Up to 3 base64 images (contracts PlaygroundImage, 4 MB each) plus the history; the 1 MiB default
  // turned a phone photo into "request body is too large".
  @RouteConfig({ bodyLimit: 13 * 1024 * 1024 })
  playground(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(PlaygroundRequest)) body: PlaygroundRequest,
    @CurrentUser() actor: AuthState,
  ): Promise<PlaygroundResponse> {
    return this.ai.playground(ws, botId, body, { userId: actor.userId });
  }
}
