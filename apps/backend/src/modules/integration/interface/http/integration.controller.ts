import {
  ConnectKiotVietRequest,
  KiotVietCredentials,
  UpdateKiotVietRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { z } from 'zod';
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
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ConnectionService } from '../../application/connection.service.js';
import { OrderPusher } from '../../application/order-push.js';

/**
 * Thin controller: Zod-validate (packages/contracts) → service → DTO. Domain errors map through
 * the global filter: KiotViet credential problems are 400 with `details.reason`, an unreachable
 * KiotViet 503, exists / sync running / stale version 409, not connected 404, a push retry of an
 * order whose push has not failed 409.
 */
@Controller('integrations')
export class IntegrationController {
  constructor(
    @Inject(ConnectionService) private readonly connections: ConnectionService,
    @Inject(OrderPusher) private readonly pusher: OrderPusher,
  ) {}

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

  /** "Thử lại": a failed order push goes back to the queue (the next scan pushes it). */
  @RequireCapability('orders.manage')
  @WorkspaceScoped()
  @Post('kiotviet/orders/:orderId/push')
  @HttpCode(202)
  retryOrderPush(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('orderId', new ZodValidationPipe(z.uuid())) orderId: string,
  ): Promise<void> {
    return this.pusher.retry(ws, orderId);
  }

  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Delete('kiotviet')
  @HttpCode(204)
  disconnect(@CurrentWorkspace() ws: WorkspaceId): Promise<void> {
    return this.connections.disconnect(ws);
  }
}
