import type { NotificationDto, NotificationList } from '@agent-sales/contracts';
import { newId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { NotifyInput } from '../api/notification.facade.js';
import {
  NotificationInvalidError,
  NotificationNotFoundError,
} from '../domain/notification.errors.js';
import {
  type DeliveryStatus,
  isSafeAppPath,
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_DEDUP_KEY_MAX,
  NOTIFICATION_TITLE_MAX,
  type NotificationChannelKind,
} from '../domain/notification.js';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from '../domain/ports/notification-channel.port.js';
import {
  type NewDelivery,
  NOTIFICATION_REPOSITORY,
  type NotificationRecord,
  type NotificationRepository,
} from '../domain/ports/notification.repository.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toNotificationDto(x: NotificationRecord): NotificationDto {
  return {
    id: x.id,
    type: x.type,
    title: x.title,
    body: x.body,
    target: x.target,
    workspaceId: x.workspaceId,
    readAt: x.readAt?.toISOString() ?? null,
    createdAt: x.createdAt.toISOString(),
  };
}

/**
 * Stores notifications for producers and serves the user's own list (S3-R5). Producers render
 * the text; this service validates it, stores the in-app row and queues the other channels.
 */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannel[],
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  /** The account of the caller's current business (3-P5); 404 when it has none. */
  async accountOf(ws: WorkspaceId): Promise<string> {
    const accountId = await this.workspaces.accountOf(ws);
    if (!accountId) throw new NotificationNotFoundError(ws);
    return accountId;
  }

  emailAvailable(): boolean {
    return this.channels.some((c) => c.kind === 'email' && c.available());
  }

  async recipientLocale(userId: string): Promise<'vi' | 'en'> {
    return (await this.identity.profile(userId as UserId))?.locale ?? 'vi';
  }

  async notify(i: NotifyInput): Promise<{ id: string; deduped: boolean }> {
    const title = i.title.trim();
    if (!title || title.length > NOTIFICATION_TITLE_MAX) {
      throw new NotificationInvalidError('title');
    }
    if (i.body.length > NOTIFICATION_BODY_MAX) throw new NotificationInvalidError('body');
    if (
      i.dedupKey !== undefined &&
      (!i.dedupKey || i.dedupKey.length > NOTIFICATION_DEDUP_KEY_MAX)
    ) {
      throw new NotificationInvalidError('dedup_key');
    }
    if (i.target?.kind === 'path' && !isSafeAppPath(i.target.path)) {
      throw new NotificationInvalidError('target_path');
    }
    if (i.target?.kind === 'assistant_report' && !UUID.test(i.target.runId)) {
      throw new NotificationInvalidError('target_run');
    }
    const kinds = [...new Set(i.channels)].filter(
      (c): c is NotificationChannelKind => c !== 'in_app',
    );
    const deliveries: NewDelivery[] = kinds.map((channel) =>
      channel === 'email' && !this.emailAvailable()
        ? { id: newId(), channel, status: 'skipped', errorCode: 'email_disabled' }
        : { id: newId(), channel },
    );
    const stored = await this.repo.insertNotification(
      {
        id: newId(),
        accountId: i.accountId,
        userId: i.userId,
        workspaceId: i.workspaceId ?? null,
        type: i.type,
        params: i.params,
        title,
        body: i.body,
        target: i.target,
        dedupKey: i.dedupKey ?? null,
      },
      deliveries,
    );
    return { id: stored.id, deduped: stored.deduped };
  }

  deliverySummary(
    accountId: string,
    userId: string,
    ids: string[],
  ): Promise<Map<string, Partial<Record<NotificationChannelKind, DeliveryStatus>>>> {
    return this.repo.deliverySummary(accountId, userId, ids);
  }

  async list(
    accountId: string,
    userId: string,
    q: { before?: string | undefined; beforeId?: string | undefined; limit: number },
  ): Promise<NotificationList> {
    const rows = await this.repo.list(accountId, userId, {
      limit: q.limit,
      ...(q.before ? { before: new Date(q.before) } : {}),
      ...(q.beforeId ? { beforeId: q.beforeId } : {}),
    });
    const last = rows.at(-1);
    return {
      items: rows.map(toNotificationDto),
      next:
        last && rows.length === q.limit
          ? { before: last.createdAt.toISOString(), beforeId: last.id }
          : null,
    };
  }

  unreadCount(accountId: string, userId: string): Promise<number> {
    return this.repo.unreadCount(accountId, userId);
  }

  async markRead(accountId: string, userId: string, id: string): Promise<NotificationDto> {
    const row = UUID.test(id) ? await this.repo.markRead(accountId, userId, id) : null;
    if (!row) throw new NotificationNotFoundError(id);
    return toNotificationDto(row);
  }

  markAllRead(accountId: string, userId: string): Promise<number> {
    return this.repo.markAllRead(accountId, userId);
  }
}
