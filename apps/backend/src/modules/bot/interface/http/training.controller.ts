import {
  CreateTrainingItemRequest,
  UpdateTrainingItemRequest,
  type TrainingItemDto,
  type TrainingHistoryDto,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../../identity/api/index.js';
import { BotService } from '../../application/bot.service.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { BOT_FACADE, type BotFacade } from '../../api/index.js';
import { TRAINING_FACADE, type TrainingFacade } from '../../../knowledge/api/index.js';

@WorkspaceScoped()
@Controller('bots/:botId')
export class TrainingController {
  constructor(
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(TRAINING_FACADE) private readonly training: TrainingFacade,
    @Inject(BotService) private readonly service: BotService,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}
  /** Display name recorded in the training history. */
  private async actor(user: AuthState): Promise<string> {
    return (await this.identity.displayName(user.userId)) ?? '';
  }
  @Get('training-items')
  async list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
  ): Promise<{ data: TrainingItemDto[] }> {
    await this.bots.getBot(ws, botId);
    return { data: await this.training.list(ws, botId) };
  }
  @Post('training-items')
  @HttpCode(201)
  async create(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(CreateTrainingItemRequest)) input: CreateTrainingItemRequest,
  ): Promise<TrainingItemDto> {
    await this.bots.getBot(ws, botId);
    return this.training.create(ws, botId, input, await this.actor(user));
  }
  @Patch('training-items/:itemId')
  async update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(UpdateTrainingItemRequest)) input: UpdateTrainingItemRequest,
  ): Promise<TrainingItemDto> {
    await this.bots.getBot(ws, botId);
    return this.training.update(ws, botId, itemId, input, await this.actor(user));
  }
  @Delete('training-items/:itemId')
  @HttpCode(204)
  async delete(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Param('itemId') itemId: string,
  ): Promise<void> {
    await this.bots.getBot(ws, botId);
    return this.training.delete(ws, botId, itemId, await this.actor(user));
  }
  @Get('training-history')
  async history(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
  ): Promise<{ data: TrainingHistoryDto[] }> {
    await this.bots.getBot(ws, botId);
    return { data: await this.training.history(ws, botId) };
  }
  @Post('training-history/:historyId/restore')
  @HttpCode(204)
  async restore(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Param('historyId') historyId: string,
  ): Promise<void> {
    await this.service.restoreHistory(ws, botId, historyId, await this.actor(user));
  }
}
