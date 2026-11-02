import type {
  DeliveryStatus,
  NotificationChannelKind,
  NotificationTarget,
  NotificationType,
} from '../notification.js';

export interface NotificationRecord {
  id: string;
  accountId: string;
  userId: string;
  workspaceId: string | null;
  type: NotificationType;
  params: Record<string, string | number | null>;
  title: string;
  body: string;
  target: NotificationTarget | null;
  dedupKey: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export type NewNotification = Omit<NotificationRecord, 'readAt' | 'createdAt'>;

export interface DeliveryRecord {
  id: string;
  accountId: string;
  userId: string;
  notificationId: string;
  channel: NotificationChannelKind;
  status: DeliveryStatus;
  /** Send attempts so far. */
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil: Date | null;
  errorCode: string | null;
  providerMessageId: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

/** A delivery stored with its notification: `queued`, or `skipped` at once (e.g. email off). */
export interface NewDelivery {
  id: string;
  channel: NotificationChannelKind;
  status?: 'queued' | 'skipped';
  errorCode?: string | null;
}

export interface DeliveryPatch {
  status: DeliveryStatus;
  attempts?: number;
  nextAttemptAt?: Date;
  errorCode?: string | null;
  providerMessageId?: string | null;
  sentAt?: Date | null;
}

export interface NotificationPage {
  /** Keyset cursor: rows strictly older than `(before, beforeId)`. */
  before?: Date;
  beforeId?: string;
  limit: number;
}

/** Notifications listed per page at most. */
export const NOTIFICATION_LIST_LIMIT = 50;

/**
 * Account-scoped storage of notifications (S3-R5). Every tenant method runs under
 * `withAccount(accountId)` AND filters on `user_id`: another user's row, even in the same
 * account, behaves as absent. Worker methods run as `app_system` across accounts.
 */
export interface NotificationRepository {
  /**
   * One transaction: the notification (`ON CONFLICT (user_id, dedup_key) DO NOTHING`) and its
   * deliveries. A deduped call stores nothing and returns the existing id with no deliveries.
   */
  insertNotification(
    row: NewNotification,
    deliveries: NewDelivery[],
  ): Promise<{ id: string; deduped: boolean; deliveries: DeliveryRecord[] }>;
  /** Newest first (`created_at desc, id desc`), at most `limit` (capped at 50). */
  list(accountId: string, userId: string, page: NotificationPage): Promise<NotificationRecord[]>;
  unreadCount(accountId: string, userId: string): Promise<number>;
  /** Sets `read_at` if still unread and returns the row; null when absent or another user's. */
  markRead(accountId: string, userId: string, id: string): Promise<NotificationRecord | null>;
  /** Returns how many rows changed. */
  markAllRead(accountId: string, userId: string): Promise<number>;
  /** Per notification id, the status of each delivery channel. */
  deliverySummary(
    accountId: string,
    userId: string,
    ids: string[],
  ): Promise<Map<string, Partial<Record<NotificationChannelKind, DeliveryStatus>>>>;

  /**
   * Worker (`app_system`): leases up to `limit` due deliveries (`queued` with
   * `next_attempt_at <= now`, or `sending` with a lapsed lease) with `FOR UPDATE SKIP LOCKED`.
   * Each becomes `sending` with `lease_until = now + leaseMs`.
   */
  claimDeliveries(now: Date, limit: number, leaseMs: number): Promise<DeliveryRecord[]>;
  /** Worker: the notifications of claimed deliveries (their title, body and target). */
  notificationsForDelivery(ids: string[]): Promise<NotificationRecord[]>;
  /**
   * Worker: stores the attempt count of a claimed delivery before it is sent, keeping the lease,
   * so a send that crashes the worker still uses up an attempt.
   */
  recordAttempt(id: string, attempts: number): Promise<void>;
  /** Worker: writes the outcome and clears the lease. */
  finishDelivery(id: string, patch: DeliveryPatch): Promise<void>;
  /** Worker: the user's `sent` emails with `sent_at >= since`, across accounts. */
  countSentEmails(userId: string, since: Date): Promise<number>;
  /** Worker: deletes notifications created before `before` (deliveries cascade). */
  purgeOld(before: Date): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
