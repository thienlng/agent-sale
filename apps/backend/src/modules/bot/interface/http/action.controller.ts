import {
  ActionInput,
  ActionTestRequest,
  UpdateActionRequest,
  type ActionDto,
  type ActionTestResult,
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

import { CurrentWorkspace, WorkspaceScoped } from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ACTION_FACADE, type ActionFacade } from '../../../action/api/index.js';
import { BOT_FACADE, type BotFacade } from '../../api/index.js';

/** /bots/{botId}/actions — the bot is verified to belong to the workspace before every call. */
@WorkspaceScoped()
@Controller('bots/:botId/actions')
export class ActionController {
  constructor(
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(ACTION_FACADE) private readonly actions: ActionFacade,
  ) {}

  @Get()
  async list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
  ): Promise<{ data: ActionDto[] }> {
    await this.bots.getBot(ws, botId);
    return { data: await this.actions.list(ws, botId) };
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(ActionInput)) input: ActionInput,
  ): Promise<ActionDto> {
    await this.bots.getBot(ws, botId);
    return this.actions.create(ws, botId, input);
  }

  @Get(':actionId')
  async get(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Param('actionId') actionId: string,
  ): Promise<ActionDto> {
    await this.bots.getBot(ws, botId);
    return this.actions.get(ws, botId, actionId);
  }

  @Patch(':actionId')
  async update(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Param('actionId') actionId: string,
    @Body(new ZodValidationPipe(UpdateActionRequest)) patch: UpdateActionRequest,
  ): Promise<ActionDto> {
    await this.bots.getBot(ws, botId);
    return this.actions.update(ws, botId, actionId, patch);
  }

  @Delete(':actionId')
  @HttpCode(204)
  async remove(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Param('actionId') actionId: string,
  ): Promise<void> {
    await this.bots.getBot(ws, botId);
    return this.actions.remove(ws, botId, actionId);
  }

  @Post(':actionId/test')
  @HttpCode(200)
  async test(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Param('actionId') actionId: string,
    @Body(new ZodValidationPipe(ActionTestRequest)) input: ActionTestRequest,
  ): Promise<ActionTestResult> {
    await this.bots.getBot(ws, botId);
    return this.actions.test(ws, botId, actionId, input.args);
  }
}
