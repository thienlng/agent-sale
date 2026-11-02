import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  schema,
  sql,
  withAccount,
  withSystem,
  type Database,
  type TenantTx,
} from '@agent-sales/db';

import type {
  DeliveryStatus,
  NotificationChannelKind,
  NotificationTarget,
  NotificationType,
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

const n = schema.notifications;
const d = schema.notificationDeliveries;

const ownsNotification = (accountId: string, userId: string) =>
  and(eq(n.accountId, accountId), eq(n.userId, userId));

function toNotification(row: typeof n.$inferSelect): NotificationRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    workspaceId: row.workspaceId,
    type: row.type as NotificationType,
    params: (row.params as NotificationRecord['params'] | null) ?? {},
    title: row.title,
    body: row.body,
    target: (row.target as NotificationTarget | null) ?? null,
    dedupKey: row.dedupKey,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

function toDelivery(row: typeof d.$inferSelect): DeliveryRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    notificationId: row.notificationId,
    channel: row.channel as NotificationChannelKind,
    status: row.status as DeliveryStatus,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    leaseUntil: row.leaseUntil,
    errorCode: row.errorCode,
    providerMessageId: row.providerMessageId,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}

/**
 * Notifications on PostgreSQL (S3-R5): tenant calls run in one `withAccount` transaction and
 * also filter on `user_id`; the delivery runner's calls run as `app_system`.
 */
export class DrizzleNotificationRepository implements NotificationRepository {
  /**
   * @param db tenant connection (`app_tenant`), under `withAccount`.
   * @param system cross-account connection (`app_system`) for the worker; null where the
   *   process has none (worker calls then throw).
   */
  constructor(
    private readonly db: Database,
    private readonly system: Database | null = null,
  ) {}

  #in<T>(accountId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return withAccount(this.db, accountId, fn);
  }

  #sys<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!this.system) {
      return Promise.reject(new Error('notification worker calls need the system connection'));
    }
    return withSystem(this.system, fn);
  }

  insertNotification(
    row: NewNotification,
    deliveries: NewDelivery[],
  ): Promise<{ id: string; deduped: boolean; deliveries: DeliveryRecord[] }> {
    return this.#in(row.accountId, async (tx) => {
      const [inserted] = await tx
        .insert(n)
        .values(row)
        .onConflictDoNothing({
          target: [n.userId, n.dedupKey],
          where: sql`dedup_key is not null`,
        })
        .returning({ id: n.id });
      if (!inserted) {
        const [existing] = await tx
          .select({ id: n.id })
          .from(n)
          .where(
            and(ownsNotification(row.accountId, row.userId), eq(n.dedupKey, row.dedupKey ?? '')),
          );
        if (!existing) throw new Error('notification dedup conflict without a visible row');
        return { id: existing.id, deduped: true, deliveries: [] };
      }
      if (deliveries.length === 0) return { id: inserted.id, deduped: false, deliveries: [] };
      const rows = await tx
        .insert(d)
        .values(
          deliveries.map((x) => ({
            id: x.id,
            accountId: row.accountId,
            userId: row.userId,
            notificationId: inserted.id,
            channel: x.channel,
            status: x.status ?? 'queued',
            errorCode: x.errorCode ?? null,
          })),
        )
        .returning();
      return { id: inserted.id, deduped: false, deliveries: rows.map(toDelivery) };
    });
  }

  list(accountId: string, userId: string, page: NotificationPage): Promise<NotificationRecord[]> {
    return this.#in(accountId, async (tx) => {
      const cursor = page.before
        ? page.beforeId
          ? or(
              lt(n.createdAt, page.before),
              and(eq(n.createdAt, page.before), lt(n.id, page.beforeId)),
            )
          : lt(n.createdAt, page.before)
        : undefined;
      const rows = await tx
        .select()
        .from(n)
        .where(and(ownsNotification(accountId, userId), cursor))
        .orderBy(desc(n.createdAt), desc(n.id))
        .limit(Math.max(1, Math.min(page.limit, NOTIFICATION_LIST_LIMIT)));
      return rows.map(toNotification);
    });
  }

  unreadCount(accountId: string, userId: string): Promise<number> {
    return this.#in(accountId, async (tx) => {
      const [row] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(n)
        .where(and(ownsNotification(accountId, userId), isNull(n.readAt)));
      return Number(row?.c ?? 0);
    });
  }

  markRead(accountId: string, userId: string, id: string): Promise<NotificationRecord | null> {
    return this.#in(accountId, async (tx) => {
      const [updated] = await tx
        .update(n)
        .set({ readAt: sql`now()` })
        .where(and(eq(n.id, id), ownsNotification(accountId, userId), isNull(n.readAt)))
        .returning();
      if (updated) return toNotification(updated);
      const [row] = await tx
        .select()
        .from(n)
        .where(and(eq(n.id, id), ownsNotification(accountId, userId)));
      return row ? toNotification(row) : null;
    });
  }

  markAllRead(accountId: string, userId: string): Promise<number> {
    return this.#in(accountId, async (tx) => {
      const rows = await tx
        .update(n)
        .set({ readAt: sql`now()` })
        .where(and(ownsNotification(accountId, userId), isNull(n.readAt)))
        .returning({ id: n.id });
      return rows.length;
    });
  }

  deliverySummary(
    accountId: string,
    userId: string,
    ids: string[],
  ): Promise<Map<string, Partial<Record<NotificationChannelKind, DeliveryStatus>>>> {
    const out = new Map<string, Partial<Record<NotificationChannelKind, DeliveryStatus>>>();
    if (ids.length === 0) return Promise.resolve(out);
    return this.#in(accountId, async (tx) => {
      const rows = await tx
        .select({ notificationId: d.notificationId, channel: d.channel, status: d.status })
        .from(d)
        .where(
          and(eq(d.accountId, accountId), eq(d.userId, userId), inArray(d.notificationId, ids)),
        );
      for (const r of rows) {
        const entry = out.get(r.notificationId) ?? {};
        entry[r.channel as NotificationChannelKind] = r.status as DeliveryStatus;
        out.set(r.notificationId, entry);
      }
      return out;
    });
  }

  claimDeliveries(now: Date, limit: number, leaseMs: number): Promise<DeliveryRecord[]> {
    const at = now.toISOString();
    return this.#sys(async (tx) => {
      const picked = await tx.execute<{ id: string }>(sql`
        update notification_deliveries
        set status = 'sending',
            lease_until = ${at}::timestamptz + ${leaseMs}::int * interval '1 millisecond'
        where id in (
          select id from notification_deliveries
          where (status = 'queued' and next_attempt_at <= ${at}::timestamptz
                 and (lease_until is null or lease_until < ${at}::timestamptz))
             or (status = 'sending' and lease_until < ${at}::timestamptz)
          order by next_attempt_at, id
          limit ${limit}
          for update skip locked)
        returning id`);
      const ids = [...picked].map((r) => r.id);
      if (ids.length === 0) return [];
      const rows = await tx.select().from(d).where(inArray(d.id, ids));
      return rows
        .map(toDelivery)
        .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime());
    });
  }

  notificationsForDelivery(ids: string[]): Promise<NotificationRecord[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.#sys(async (tx) => {
      const rows = await tx
        .select()
        .from(n)
        .where(inArray(n.id, [...new Set(ids)]));
      return rows.map(toNotification);
    });
  }

  finishDelivery(id: string, patch: DeliveryPatch): Promise<void> {
    return this.#sys(async (tx) => {
      const values: Partial<typeof d.$inferInsert> = { status: patch.status, leaseUntil: null };
      if (patch.attempts !== undefined) values.attempts = patch.attempts;
      if (patch.nextAttemptAt !== undefined) values.nextAttemptAt = patch.nextAttemptAt;
      if (patch.errorCode !== undefined) values.errorCode = patch.errorCode;
      if (patch.providerMessageId !== undefined) values.providerMessageId = patch.providerMessageId;
      if (patch.sentAt !== undefined) values.sentAt = patch.sentAt;
      await tx.update(d).set(values).where(eq(d.id, id));
    });
  }

  countSentEmails(userId: string, since: Date): Promise<number> {
    return this.#sys(async (tx) => {
      const [row] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(d)
        .where(
          and(
            eq(d.userId, userId),
            eq(d.channel, 'email'),
            eq(d.status, 'sent'),
            sql`${d.sentAt} >= ${since.toISOString()}::timestamptz`,
          ),
        );
      return Number(row?.c ?? 0);
    });
  }

  purgeOld(before: Date): Promise<number> {
    return this.#sys(async (tx) => {
      const rows = await tx.delete(n).where(lt(n.createdAt, before)).returning({ id: n.id });
      return rows.length;
    });
  }
}
