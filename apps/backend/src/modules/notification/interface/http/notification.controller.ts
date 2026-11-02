import {
  NotificationListQuery,
  type NotificationCount,
  type NotificationDto,
  type NotificationList,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { NotificationService } from '../../application/notification.service.js';

/**
 * The caller's own notifications (3-P5): the current business gives the account; every query
 * also filters on the user, so another user's id answers 404.
 */
@WorkspaceScoped()
@Controller('notifications')
export class NotificationController {
  constructor(@Inject(NotificationService) private readonly service: NotificationService) {}

  #account(ws: WorkspaceId): Promise<string> {
    return this.service.accountOf(ws);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(NotificationListQuery)) q: NotificationListQuery,
  ): Promise<NotificationList> {
    return this.service.list(await this.#account(ws), user.userId, q);
  }

  @Get('unread-count')
  async unreadCount(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
  ): Promise<NotificationCount> {
    return { count: await this.service.unreadCount(await this.#account(ws), user.userId) };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
  ): Promise<NotificationCount> {
    return { count: await this.service.markAllRead(await this.#account(ws), user.userId) };
  }

  @Post(':notificationId/read')
  @HttpCode(200)
  async read(
    @CurrentUser() user: AuthState,
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('notificationId') id: string,
  ): Promise<NotificationDto> {
    return this.service.markRead(await this.#account(ws), user.userId, id);
  }
}
