import {
  CreateCrmOptionRequest,
  CreateSavedViewRequest,
  CreateTagRequest,
  ReorderCrmOptionsRequest,
  UpdateCrmOptionRequest,
  UpdateSavedViewRequest,
  UpdateTagRequest,
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
  Put,
} from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { CrmSettingsService } from '../../application/crm-settings.service.js';
import { SavedViewService } from '../../application/saved-view.service.js';

/** Thin controller: sources, statuses, tags, assignees and saved views. */
@WorkspaceScoped()
@Controller()
export class CrmSettingsController {
  constructor(
    @Inject(CrmSettingsService) private readonly settings: CrmSettingsService,
    @Inject(SavedViewService) private readonly views: SavedViewService,
  ) {}

  // `/order` is declared before `/:optionId` so it is never taken for an id.
  @Put('crm/sources/order')
  async reorderSources(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(ReorderCrmOptionsRequest)) body: unknown,
  ) {
    return { data: await this.settings.reorder(ws, 'source', body) };
  }

  @Put('crm/statuses/order')
  async reorderStatuses(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(ReorderCrmOptionsRequest)) body: unknown,
  ) {
    return { data: await this.settings.reorder(ws, 'status', body) };
  }

  @Get('crm/sources')
  async listSources(@CurrentWorkspace() ws: WorkspaceId) {
    return { data: await this.settings.listOptions(ws, 'source') };
  }

  @Post('crm/sources')
  @HttpCode(201)
  createSource(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(CreateCrmOptionRequest)) body: unknown,
  ) {
    return this.settings.createOption(ws, 'source', body);
  }

  @Patch('crm/sources/:optionId')
  updateSource(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('optionId') id: string,
    @Body(new ZodValidationPipe(UpdateCrmOptionRequest)) body: unknown,
  ) {
    return this.settings.updateOption(ws, 'source', id, body);
  }

  @Get('crm/statuses')
  async listStatuses(@CurrentWorkspace() ws: WorkspaceId) {
    return { data: await this.settings.listOptions(ws, 'status') };
  }

  @Post('crm/statuses')
  @HttpCode(201)
  createStatus(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(CreateCrmOptionRequest)) body: unknown,
  ) {
    return this.settings.createOption(ws, 'status', body);
  }

  @Patch('crm/statuses/:optionId')
  updateStatus(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('optionId') id: string,
    @Body(new ZodValidationPipe(UpdateCrmOptionRequest)) body: unknown,
  ) {
    return this.settings.updateOption(ws, 'status', id, body);
  }

  @Get('crm/tags')
  async tags(@CurrentWorkspace() ws: WorkspaceId) {
    return { data: await this.settings.listTags(ws) };
  }

  @Post('crm/tags')
  @HttpCode(201)
  createTag(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateTagRequest)) body: unknown,
  ) {
    return this.settings.createTag(ws, body, user.userId);
  }

  @Patch('crm/tags/:tagId')
  updateTag(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('tagId') id: string,
    @Body(new ZodValidationPipe(UpdateTagRequest)) body: unknown,
  ) {
    return this.settings.updateTag(ws, id, body);
  }

  @Get('crm/assignees')
  async assignees(@CurrentWorkspace() ws: WorkspaceId) {
    return { data: await this.settings.assignees(ws) };
  }

  @Get('saved-views')
  async savedViews(@CurrentWorkspace() ws: WorkspaceId, @CurrentUser() user: AuthState) {
    return { data: await this.views.list(ws, user.userId) };
  }

  @Post('saved-views')
  @HttpCode(201)
  createView(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateSavedViewRequest)) body: unknown,
  ) {
    return this.views.create(ws, body, user.userId);
  }

  @Patch('saved-views/:viewId')
  updateView(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('viewId') id: string,
    @Body(new ZodValidationPipe(UpdateSavedViewRequest)) body: unknown,
  ) {
    return this.views.update(ws, id, body, user.userId);
  }

  @Delete('saved-views/:viewId')
  @HttpCode(204)
  deleteView(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('viewId') id: string,
  ): Promise<void> {
    return this.views.delete(ws, id, user.userId);
  }
}
