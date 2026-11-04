import type { NotificationChannelKind } from '../notification.js';

/** One message to one recipient, already rendered in their language. */
export interface OutgoingMessage {
  /** The recipient's own login address (email); the user id for push (it finds the devices). */
  to: string;
  accountId: string;
  userId: string;
  /** Collapses repeated pushes about the same thing on a device (e.g. one conversation). */
  tag?: string | null;
  locale: 'vi' | 'en';
  title: string;
  body: string;
  /** Absolute link into the dashboard, or null when `APP_PUBLIC_URL` is unset. */
  link: string | null;
}

/** A delivery channel adapter (S3-R8): email through the `Mailer` (Resend), Web Push (T-190). */
export interface NotificationChannel {
  kind: NotificationChannelKind;
  /** False when the channel is not configured (e.g. no `RESEND_API_KEY`). */
  available(): boolean;
  /** Push: whether the recipient has any device; false skips the delivery (`no_recipient`). */
  hasRecipient?(m: Pick<OutgoingMessage, 'accountId' | 'userId'>): Promise<boolean>;
  send(m: OutgoingMessage): Promise<{ providerMessageId: string | null }>;
}

/** The registered channels (`NotificationChannel[]`); a missing kind means "not available". */
export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');
