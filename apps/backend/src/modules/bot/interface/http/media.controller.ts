import { UploadBotImageRequest } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../../identity/api/index.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { MEDIA_FACADE, type MediaFacade } from '../../../knowledge/api/index.js';
import { BotService } from '../../application/bot.service.js';

@WorkspaceScoped()
@Controller('bots')
export class MediaController {
  constructor(
    @Inject(BotService) private readonly bots: BotService,
    @Inject(MEDIA_FACADE) private readonly media: MediaFacade,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}

  @Post(':botId/media-upload')
  @HttpCode(201)
  @RouteConfig({ bodyLimit: 2_097_152 })
  async upload(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(UploadBotImageRequest)) input: UploadBotImageRequest,
  ) {
    await this.bots.get(ws, botId);
    return this.media.upload(
      ws,
      botId,
      input,
      (await this.identity.displayName(user.userId)) ?? '',
    );
  }
}
