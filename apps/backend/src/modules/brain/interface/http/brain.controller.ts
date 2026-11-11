import {
  type AutonomySettingsResponse,
  type BrainSettingsDto,
  type BrainUsageDto,
  type ConversationSignalResponse,
  type EvaluateSignalsResponse,
  UpdateAutonomySettingsRequest,
  UpdateBrainSettingsRequest,
  UpdateConversationSignalRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { BrainFacadeImpl } from '../../application/brain.facade.impl.js';

const idPipe = new ZodValidationPipe(z.uuid());

/** The AI's signals of one conversation (spec 2026-11-11 §3). Reads: any member. */
@WorkspaceScoped()
@Controller('conversations')
export class SignalsController {
  constructor(@Inject(BrainFacadeImpl) private readonly brain: BrainFacadeImpl) {}

  @Get(':id/signals')
  async get(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', idPipe) id: string,
  ): Promise<ConversationSignalResponse> {
    return { signal: await this.brain.signalOf(ws, id) };
  }

  /** 200 with a status: `capped` / `nothing_new` / `disabled` are answers, not errors. */
  @RequireCapability('contacts.edit')
  @Post(':id/signals/evaluate')
  @HttpCode(200)
  evaluate(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', idPipe) id: string,
  ): Promise<EvaluateSignalsResponse> {
    return this.brain.evaluateNow(ws, id, 'manual');
  }

  @RequireCapability('contacts.edit')
  @Patch(':id/signals')
  async update(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateConversationSignalRequest))
    body: UpdateConversationSignalRequest,
  ): Promise<ConversationSignalResponse> {
    return { signal: await this.brain.updateSignal(ws, id, body) };
  }
}

/** Business Brain settings and today's evaluation count. Changing settings: owner and admin. */
@WorkspaceScoped()
@Controller('brain')
export class BrainController {
  constructor(@Inject(BrainFacadeImpl) private readonly brain: BrainFacadeImpl) {}

  @Get('settings')
  settings(@CurrentWorkspace() ws: WorkspaceId): Promise<BrainSettingsDto> {
    return this.brain.settings(ws);
  }

  @RequireCapability('settings.manage')
  @Put('settings')
  putSettings(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(UpdateBrainSettingsRequest)) body: UpdateBrainSettingsRequest,
  ): Promise<BrainSettingsDto> {
    return this.brain.putSettings(ws, body);
  }

  @Get('autonomy')
  autonomy(@CurrentWorkspace() ws: WorkspaceId): Promise<AutonomySettingsResponse> {
    return this.brain.autonomy(ws);
  }

  /** Raising what the AI may do alone is the owner's or an admin's call. */
  @RequireCapability('settings.manage')
  @Put('autonomy')
  putAutonomy(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() u: AuthState,
    @Body(new ZodValidationPipe(UpdateAutonomySettingsRequest))
    body: UpdateAutonomySettingsRequest,
  ): Promise<AutonomySettingsResponse> {
    return this.brain.putAutonomy(ws, body, u.userId);
  }

  @Get('usage')
  usage(@CurrentWorkspace() ws: WorkspaceId): Promise<BrainUsageDto> {
    return this.brain.usage(ws);
  }
}
