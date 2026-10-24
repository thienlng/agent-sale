import {
  type BotDto,
  type BotReadiness,
  CreateBotRequest,
  CreateFaqRequest,
  ImportFaqsRequest,
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

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../../identity/api/index.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { BotService } from '../../application/bot.service.js';

/** Thin controller for /bots and /bots/{botId}/faqs. Every route is workspace-scoped. */
@WorkspaceScoped()
@Controller('bots')
export class BotController {
  constructor(
    @Inject(BotService) private readonly bots: BotService,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}

  /** Display name recorded in the training history. */
  private async actor(user: AuthState): Promise<string> {
    return (await this.identity.displayName(user.userId)) ?? '';
  }

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
  async update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(UpdateBotRequest)) body: UpdateBotRequest,
  ): Promise<BotDto> {
    return this.bots.update(ws, botId, body, await this.actor(user));
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

  @Post(':botId/faqs/import')
  @HttpCode(201)
  async importFaqs(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(ImportFaqsRequest)) input: ImportFaqsRequest,
  ): Promise<FaqListResponse> {
    return { data: await this.bots.importFaqs(ws, botId, input, await this.actor(user)) };
  }

  @Post(':botId/faqs')
  @HttpCode(201)
  async createFaq(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(CreateFaqRequest)) body: CreateFaqRequest,
  ): Promise<FaqDto> {
    return this.bots.createFaq(ws, botId, body, await this.actor(user));
  }

  @Patch(':botId/faqs/:faqId')
  async updateFaq(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Param('faqId') faqId: string,
    @Body(new ZodValidationPipe(UpdateFaqRequest)) body: UpdateFaqRequest,
  ): Promise<FaqDto> {
    return this.bots.updateFaq(ws, botId, faqId, body, await this.actor(user));
  }

  @Delete(':botId/faqs/:faqId')
  @HttpCode(204)
  async deleteFaq(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('botId') botId: string,
    @Param('faqId') faqId: string,
  ): Promise<void> {
    return this.bots.deleteFaq(ws, botId, faqId, await this.actor(user));
  }
}
