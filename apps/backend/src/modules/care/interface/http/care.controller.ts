import {
  type AiDoneResponse,
  ApproveCareMessageRequest,
  BulkApproveCareMessagesRequest,
  type BulkApproveCareMessagesResponse,
  type CareMessageDto,
  type CareSettingsResponse,
  type CareTemplateDto,
  ImpactQuery as ImpactQuerySchema,
  type ImpactResponse,
  roleCan,
  UpdateCareTemplateRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../../../../common/http/api-error.js';
import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ApprovalService } from '../../application/approval.service.js';
import { CareSettingsService } from '../../application/care-settings.service.js';
import { ImpactQuery } from '../../application/impact.query.js';

const idPipe = new ZodValidationPipe(z.uuid());
/** Sales and care (no `contacts.view_all`) see their own and unassigned customers. */
const viewer = (u: AuthState) => ({
  userId: u.userId,
  viewAll: roleCan(u.role, 'contacts.view_all'),
});

/** Care agent settings (spec 2026-11-11 care §5). Reads: any member; changes: owner and admin. */
@WorkspaceScoped()
@Controller('care')
export class CareController {
  constructor(@Inject(CareSettingsService) private readonly settings: CareSettingsService) {}

  @Get('settings')
  get(@CurrentWorkspace() ws: WorkspaceId): Promise<CareSettingsResponse> {
    return this.settings.settings(ws);
  }

  @RequireCapability('settings.manage')
  @Put('templates/:key')
  putTemplate(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateCareTemplateRequest)) body: UpdateCareTemplateRequest,
  ): Promise<CareTemplateDto> {
    return this.settings.putTemplate(ws, key, body);
  }
}

/** "Chờ duyệt" and "AI đã làm" on Today. Reading needs `contacts.view`, deciding `contacts.edit`. */
@WorkspaceScoped()
@Controller('today')
export class CareTodayController {
  constructor(@Inject(ApprovalService) private readonly approvals: ApprovalService) {}

  @RequireCapability('contacts.edit')
  @Post('approval/approve-all')
  @HttpCode(200)
  approveAll(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() u: AuthState,
    @Body(new ZodValidationPipe(BulkApproveCareMessagesRequest))
    body: BulkApproveCareMessagesRequest,
  ): Promise<BulkApproveCareMessagesResponse> {
    return this.approvals.approveAll(ws, viewer(u), body.ids);
  }

  @RequireCapability('contacts.edit')
  @Post('approval/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() u: AuthState,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ApproveCareMessageRequest)) body: ApproveCareMessageRequest,
  ): Promise<CareMessageDto> {
    return this.approvals.approve(ws, viewer(u), id, body.text);
  }

  @RequireCapability('contacts.edit')
  @Post('approval/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() u: AuthState,
    @Param('id', idPipe) id: string,
  ): Promise<CareMessageDto> {
    return this.approvals.reject(ws, viewer(u), id);
  }

  @RequireCapability('contacts.view')
  @Get('ai-done')
  aiDone(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() u: AuthState,
  ): Promise<AiDoneResponse> {
    return this.approvals.aiDone(ws, viewer(u));
  }
}

/**
 * "Rapiz đã mang lại" (spec §6): business-wide figures, so statistics (`analytics.view`) on every
 * customer (`contacts.view_all`): owner, admin and analyst.
 */
@WorkspaceScoped()
@Controller('brain')
export class ImpactController {
  constructor(@Inject(ImpactQuery) private readonly impact: ImpactQuery) {}

  @RequireCapability('analytics.view')
  @Get('impact')
  get(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() u: AuthState,
    @Query(new ZodValidationPipe(ImpactQuerySchema)) q: ImpactQuerySchema,
  ): Promise<ImpactResponse> {
    if (!roleCan(u.role, 'contacts.view_all')) {
      throw new ApiError('FORBIDDEN', 'Your role cannot do this', {
        capability: 'contacts.view_all',
      });
    }
    return this.impact.impact(ws, q.range);
  }
}
