import {
  ScheduleDraft,
  SchedulePatch,
  ScheduleRunListQuery,
  type AssistantThreadDto,
  type ScheduleDto,
  type ScheduleList,
  type SchedulePreview,
  type ScheduleRunList,
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
  Query,
} from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import type { AssistantActor } from '../../api/assistant.facade.js';
import { SchedulesService } from '../../application/schedules.service.js';

const actor = (user: AuthState, businessId: WorkspaceId): AssistantActor => ({
  userId: user.userId,
  businessId,
});

/**
 * The owner's report and alert schedules (T-172, spec §5). The service answers 403 unless the
 * caller owns the account of the current business, 404 for another owner's schedule or run, and
 * 400 with the problem codes for an invalid draft.
 */
@WorkspaceScoped()
@Controller('assistant')
export class SchedulesController {
  constructor(@Inject(SchedulesService) private readonly schedules: SchedulesService) {}

  @Get('schedules')
  list(@CurrentUser() user: AuthState, @CurrentWorkspace() ws: WorkspaceId): Promise<ScheduleList> {
    return this.schedules.list(actor(user, ws));
  }

  @Post('schedules')
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(ScheduleDraft)) body: ScheduleDraft,
  ): Promise<ScheduleDto> {
    return this.schedules.create(actor(user, ws), body);
  }

  @Post('schedules/preview')
  @HttpCode(200)
  preview(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(ScheduleDraft)) body: ScheduleDraft,
  ): Promise<SchedulePreview> {
    return this.schedules.preview(actor(user, ws), body);
  }

  @Patch('schedules/:scheduleId')
  update(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('scheduleId') id: string,
    @Body(new ZodValidationPipe(SchedulePatch)) body: SchedulePatch,
  ): Promise<ScheduleDto> {
    return this.schedules.update(actor(user, ws), id, body);
  }

  @Post('schedules/:scheduleId/pause')
  @HttpCode(200)
  pause(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('scheduleId') id: string,
  ): Promise<ScheduleDto> {
    return this.schedules.pause(actor(user, ws), id);
  }

  @Post('schedules/:scheduleId/resume')
  @HttpCode(200)
  resume(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('scheduleId') id: string,
  ): Promise<ScheduleDto> {
    return this.schedules.resume(actor(user, ws), id);
  }

  @Post('schedules/:scheduleId/run')
  @HttpCode(200)
  run(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('scheduleId') id: string,
  ): Promise<ScheduleDto> {
    return this.schedules.requestRun(actor(user, ws), id);
  }

  @Delete('schedules/:scheduleId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('scheduleId') id: string,
  ): Promise<void> {
    await this.schedules.remove(actor(user, ws), id);
  }

  @Get('schedules/:scheduleId/runs')
  runs(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('scheduleId') id: string,
    @Query(new ZodValidationPipe(ScheduleRunListQuery)) q: ScheduleRunListQuery,
  ): Promise<ScheduleRunList> {
    return this.schedules.runs(actor(user, ws), id, q.limit);
  }

  @Post('schedule-runs/:runId/thread')
  @HttpCode(200)
  thread(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('runId') runId: string,
  ): Promise<AssistantThreadDto> {
    // The display name goes into the new thread's prompt; read only when one is created.
    const ownerName = async () => (await user.displayName?.()) ?? null;
    return this.schedules.threadForRun({ ...actor(user, ws), ownerName }, runId);
  }
}
