/**
 * In-app notifications and their email/push deliveries (T-172, S3-R5…R8). In-app delivery is
 * the notification row itself; every other channel is one delivery row.
 */

export type NotificationType = 'assistant.report' | 'assistant.alert' | 'assistant.schedule_paused';
export type NotificationChannelKind = 'email' | 'push';
export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';

export type NotificationTarget =
  { kind: 'path'; path: string } | { kind: 'assistant_report'; runId: string };

export const NOTIFICATION_TITLE_MAX = 160;
export const NOTIFICATION_BODY_MAX = 4000;
export const NOTIFICATION_DEDUP_KEY_MAX = 160;
