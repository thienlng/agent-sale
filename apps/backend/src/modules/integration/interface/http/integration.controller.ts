import {
  ConnectKiotVietRequest,
  KiotVietCredentials,
  UpdateKiotVietRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Delete, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ConnectionService } from '../../application/connection.service.js';

/**
 * Thin controller: Zod-validate (packages/contracts) → service → DTO. Domain errors map through
 * the global filter: KiotViet credential problems are 400 with `details.reason`, an unreachable
 * KiotViet 503, exists / sync running / stale version 409, not connected 404.
 */
@Controller('integrations')
export class IntegrationController {
  constructor(@Inject(ConnectionService) private readonly connections: ConnectionService) {}

  @RequireCapability('catalog.manage')
  @WorkspaceScoped()
  @Get()
  list(@CurrentWorkspace() ws: WorkspaceId) {
    return this.connections.list(ws);
  }

  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Post('kiotviet/test')
  @HttpCode(200)
  test(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(KiotVietCredentials)) body: KiotVietCredentials,
  ) {
    return this.connections.test(ws, body);
  }

  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Post('kiotviet')
  connect(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(ConnectKiotVietRequest)) body: ConnectKiotVietRequest,
  ) {
    return this.connections.connect(ws, user.userId, body);
  }

  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Patch('kiotviet')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(UpdateKiotVietRequest)) body: UpdateKiotVietRequest,
  ) {
    return this.connections.update(ws, body);
  }

  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Post('kiotviet/sync')
  @HttpCode(202)
  syncNow(@CurrentWorkspace() ws: WorkspaceId): Promise<void> {
    return this.connections.syncNow(ws);
  }

  @RequireCapability('catalog.manage')
  @WorkspaceScoped()
  @Get('kiotviet/log')
  log(@CurrentWorkspace() ws: WorkspaceId) {
    return this.connections.log(ws);
  }

  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Delete('kiotviet')
  @HttpCode(204)
  disconnect(@CurrentWorkspace() ws: WorkspaceId): Promise<void> {
    return this.connections.disconnect(ws);
  }
}
