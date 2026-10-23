import {
  type BotDto,
  type BotReadiness,
  CreateBotRequest,
  CreateFaqRequest,
  type FaqDto,
  type FaqListResponse,
  UpdateBotRequest,
  UpdateFaqRequest,
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
import { BotService } from '../../application/bot.service.js';

/** Thin controller for /bots and /bots/{botId}/faqs. Every route is workspace-scoped. */
@WorkspaceScoped()
@Controller('bots')
export class BotController {
  constructor(@Inject(BotService) private readonly bots: BotService) {}

  @Get()
  async list(@CurrentWorkspace() ws: WorkspaceId): Promise<{ data: BotDto[] }> {
    return { data: await this.bots.list(ws) };
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(CreateBotRequest)) body: CreateBotRequest,
  ): Promise<BotDto> {
    return this.bots.create(ws, body);
  }

  @Get(':botId')
  get(@CurrentWorkspace() ws: WorkspaceId, @Param('botId') botId: string): Promise<BotDto> {
    return this.bots.get(ws, botId);
  }

  @Patch(':botId')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(UpdateBotRequest)) body: UpdateBotRequest,
  ): Promise<BotDto> {
    return this.bots.update(ws, botId, body);
  }

  @Get(':botId/readiness')
  readiness(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
  ): Promise<BotReadiness> {
    return this.bots.readiness(ws, botId);
  }

  @Get(':botId/faqs')
  async faqs(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
  ): Promise<FaqListResponse> {
    return { data: await this.bots.listFaqs(ws, botId) };
  }

  @Post(':botId/faqs')
  @HttpCode(201)
  createFaq(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(CreateFaqRequest)) body: CreateFaqRequest,
  ): Promise<FaqDto> {
    return this.bots.createFaq(ws, botId, body);
  }

  @Patch(':botId/faqs/:faqId')
  updateFaq(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Param('faqId') faqId: string,
    @Body(new ZodValidationPipe(UpdateFaqRequest)) body: UpdateFaqRequest,
  ): Promise<FaqDto> {
    return this.bots.updateFaq(ws, botId, faqId, body);
  }

  @Delete(':botId/faqs/:faqId')
  @HttpCode(204)
  deleteFaq(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Param('faqId') faqId: string,
  ): Promise<void> {
    return this.bots.deleteFaq(ws, botId, faqId);
  }
}
