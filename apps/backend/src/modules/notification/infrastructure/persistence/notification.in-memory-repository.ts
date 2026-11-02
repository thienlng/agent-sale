import type { DeliveryStatus, NotificationChannelKind } from '../../domain/notification.js';
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_DEDUP_KEY_MAX,
  NOTIFICATION_TITLE_MAX,
} from '../../domain/notification.js';
import {
  type DeliveryPatch,
  type DeliveryRecord,
  type NewDelivery,
  type NewNotification,
  NOTIFICATION_LIST_LIMIT,
  type NotificationPage,
  type NotificationRecord,
  type NotificationRepository,
} from '../../domain/ports/notification.repository.js';

const mine = (accountId: string, userId: string, x: { accountId: string; userId: string }) =>
  x.accountId === accountId && x.userId === userId;

/** Process-local twin of the Drizzle repository (tests, and the API without a database). */
export class InMemoryNotificationRepository implements NotificationRepository {
  readonly notifications = new Map<string, NotificationRecord>();
  readonly deliveries = new Map<string, DeliveryRecord>();
  #clock = 0;

  /** Strictly increasing timestamps so ordering is deterministic in tests. */
  #now(): Date {
    this.#clock = Math.max(this.#clock + 1, Date.now());
    return new Date(this.#clock);
  }

  async insertNotification(
    row: NewNotification,
    deliveries: NewDelivery[],
  ): Promise<{ id: string; deduped: boolean; deliveries: DeliveryRecord[] }> {
    // Mirrors the table's CHECK constraints.
    if (row.title.length > NOTIFICATION_TITLE_MAX) throw new Error('notification title too long');
    if (row.body.length > NOTIFICATION_BODY_MAX) throw new Error('notification body too long');
    if (row.dedupKey && row.dedupKey.length > NOTIFICATION_DEDUP_KEY_MAX) {
      throw new Error('notification dedup key too long');
    }
    if (row.dedupKey !== null) {
      const existing = [...this.notifications.values()].find(
        (x) => x.userId === row.userId && x.dedupKey === row.dedupKey,
      );
      if (existing) return { id: existing.id, deduped: true, deliveries: [] };
    }
    if (this.notifications.has(row.id)) throw new Error('notification id already used');
    const createdAt = this.#now();
    this.notifications.set(row.id, { ...structuredClone(row), readAt: null, createdAt });
    const channels = new Set<string>();
    const stored: DeliveryRecord[] = [];
    for (const x of deliveries) {
      if (channels.has(x.channel)) throw new Error('duplicate notification delivery channel');
      channels.add(x.channel);
      const rec: DeliveryRecord = {
        id: x.id,
        accountId: row.accountId,
        userId: row.userId,
        notificationId: row.id,
        channel: x.channel,
        status: x.status ?? 'queued',
        attempts: 0,
        nextAttemptAt: createdAt,
        leaseUntil: null,
        errorCode: x.errorCode ?? null,
        providerMessageId: null,
        sentAt: null,
        createdAt,
      };
      this.deliveries.set(rec.id, rec);
      stored.push(structuredClone(rec));
    }
    return { id: row.id, deduped: false, deliveries: stored };
  }

  async list(
    accountId: string,
    userId: string,
    page: NotificationPage,
  ): Promise<NotificationRecord[]> {
    const before = page.before?.getTime();
    return [...this.notifications.values()]
      .filter((x) => mine(accountId, userId, x))
      .filter((x) => {
        if (before === undefined) return true;
        const at = x.createdAt.getTime();
        if (at < before) return true;
        return page.beforeId !== undefined && at === before && x.id < page.beforeId;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, Math.max(1, Math.min(page.limit, NOTIFICATION_LIST_LIMIT)))
      .map((x) => structuredClone(x));
  }

  async unreadCount(accountId: string, userId: string): Promise<number> {
    return [...this.notifications.values()].filter(
      (x) => mine(accountId, userId, x) && x.readAt === null,
    ).length;
  }

  async markRead(
    accountId: string,
    userId: string,
    id: string,
  ): Promise<NotificationRecord | null> {
    const x = this.notifications.get(id);
    if (!x || !mine(accountId, userId, x)) return null;
    x.readAt ??= this.#now();
    return structuredClone(x);
  }

  async markAllRead(accountId: string, userId: string): Promise<number> {
    let count = 0;
    for (const x of this.notifications.values()) {
      if (mine(accountId, userId, x) && x.readAt === null) {
        x.readAt = this.#now();
        count++;
      }
    }
    return count;
  }

  async deliverySummary(
    accountId: string,
    userId: string,
    ids: string[],
  ): Promise<Map<string, Partial<Record<NotificationChannelKind, DeliveryStatus>>>> {
    const out = new Map<string, Partial<Record<NotificationChannelKind, DeliveryStatus>>>();
    const wanted = new Set(ids);
    for (const x of this.deliveries.values()) {
      if (!mine(accountId, userId, x) || !wanted.has(x.notificationId)) continue;
      const entry = out.get(x.notificationId) ?? {};
      entry[x.channel] = x.status;
      out.set(x.notificationId, entry);
    }
    return out;
  }

  async claimDeliveries(now: Date, limit: number, leaseMs: number): Promise<DeliveryRecord[]> {
    const at = now.getTime();
    const due = [...this.deliveries.values()]
      .filter(
        (x) =>
          (x.status === 'queued' &&
            x.nextAttemptAt.getTime() <= at &&
            (x.leaseUntil === null || x.leaseUntil.getTime() < at)) ||
          (x.status === 'sending' && x.leaseUntil !== null && x.leaseUntil.getTime() < at),
      )
      .sort(
        (a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || (a.id < b.id ? -1 : 1),
      )
      .slice(0, limit);
    for (const x of due) {
      x.status = 'sending';
      x.leaseUntil = new Date(at + leaseMs);
    }
    return due.map((x) => structuredClone(x));
  }

  async finishDelivery(id: string, patch: DeliveryPatch): Promise<void> {
    const x = this.deliveries.get(id);
    if (!x) return;
    x.status = patch.status;
    x.leaseUntil = null;
    if (patch.attempts !== undefined) x.attempts = patch.attempts;
    if (patch.nextAttemptAt !== undefined) x.nextAttemptAt = patch.nextAttemptAt;
    if (patch.errorCode !== undefined) x.errorCode = patch.errorCode;
    if (patch.providerMessageId !== undefined) x.providerMessageId = patch.providerMessageId;
    if (patch.sentAt !== undefined) x.sentAt = patch.sentAt;
  }

  async countSentEmails(userId: string, since: Date): Promise<number> {
    return [...this.deliveries.values()].filter(
      (x) =>
        x.userId === userId &&
        x.channel === 'email' &&
        x.status === 'sent' &&
        x.sentAt !== null &&
        x.sentAt.getTime() >= since.getTime(),
    ).length;
  }

  async purgeOld(before: Date): Promise<number> {
    let count = 0;
    for (const [id, x] of this.notifications) {
      if (x.createdAt.getTime() < before.getTime()) {
        this.notifications.delete(id);
        for (const [did, dx] of this.deliveries)
          if (dx.notificationId === id) this.deliveries.delete(did);
        count++;
      }
    }
    return count;
  }
}
