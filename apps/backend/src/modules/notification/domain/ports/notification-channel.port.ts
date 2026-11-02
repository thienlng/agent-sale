import type { NotificationChannelKind } from '../notification.js';

/** One message to one recipient, already rendered in their language. */
export interface OutgoingMessage {
  /** The recipient's own login address (email) or device (push, later). */
  to: string;
  locale: 'vi' | 'en';
  title: string;
  body: string;
  /** Absolute link into the dashboard, or null when `APP_PUBLIC_URL` is unset. */
  link: string | null;
}

/** A delivery channel adapter (S3-R8): email over SMTP now, push later. */
export interface NotificationChannel {
  kind: NotificationChannelKind;
  /** False when the channel is not configured (e.g. no `SMTP_URL`). */
  available(): boolean;
  send(m: OutgoingMessage): Promise<{ providerMessageId: string | null }>;
}

/** The registered channels (`NotificationChannel[]`); a missing kind means "not available". */
export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');
