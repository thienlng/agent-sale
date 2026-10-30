import {
  CreateStayRequest,
  StayListQuery,
  StayQuoteRequest,
  UpdateStayStatusRequest,
  type StayQuote,
  type StayRequestDto,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
  type AuthState,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { LodgingService } from '../../application/lodging.service.js';

@WorkspaceScoped()
@Controller('stay-requests')
export class LodgingController {
  constructor(@Inject(LodgingService) private readonly lodging: LodgingService) {}
  @Get()
  @RequireCapability('orders.view')
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(StayListQuery)) q: z.infer<typeof StayListQuery>,
  ): Promise<{ data: StayRequestDto[]; nextOffset: number | null }> {
    return this.lodging.list(ws, q);
  }
  @Post('quote')
  @HttpCode(200)
  @RequireCapability('orders.view')
  quote(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(StayQuoteRequest)) body: StayQuoteRequest,
  ): Promise<StayQuote> {
    return this.lodging.quote(ws, body);
  }
  @Post()
  @HttpCode(201)
  @RequireCapability('orders.manage')
  create(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Body(new ZodValidationPipe(CreateStayRequest)) body: CreateStayRequest,
  ): Promise<StayRequestDto> {
    return this.lodging.create(ws, body, actor.userId);
  }
  @Get(':id')
  @RequireCapability('orders.view')
  get(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ): Promise<StayRequestDto> {
    return this.lodging.get(ws, id);
  }
  @Patch(':id/status')
  @RequireCapability('orders.manage')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(UpdateStayStatusRequest)) body: UpdateStayStatusRequest,
  ): Promise<StayRequestDto> {
    return this.lodging.updateStatus(ws, id, body, actor.userId);
  }
}
