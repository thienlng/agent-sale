import { z } from 'zod';

/** In-app notifications of the current user (T-172). */

export const NotificationType = z.enum([
  'assistant.report',
  'assistant.alert',
  'assistant.schedule_paused',
  /** The bot handed a conversation to staff (T-190). */
  'inbox.handoff',
  /** A customer wrote in a conversation staff are handling (T-190). */
  'inbox.message',
  /** A whole-workspace data export is ready to download, or failed (SET-10). */
  'dataexport.ready',
  'dataexport.failed',
  /** A task assigned to the user reached its due time (CRM-04, spec 2026-11-11 §4). */
  'task.due',
  /** An evaluation newly found a customer complaint (Business Brain, spec 2026-11-11 §6). */
  'brain.complaint',
  /** The morning briefing of Today's counts (Business Brain, spec 2026-11-11 §6). */
  'today.briefing',
]);
export type NotificationType = z.infer<typeof NotificationType>;

/** Where a click goes: a dashboard path, or the assistant thread of a report run. */
export const NotificationTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().max(300) }),
  z.object({ kind: z.literal('assistant_report'), runId: z.uuid() }),
  /** One inbox conversation of the notification's business (T-190). */
  z.object({ kind: z.literal('conversation'), conversationId: z.uuid() }),
]);
export type NotificationTarget = z.infer<typeof NotificationTarget>;

export const NotificationDto = z.object({
  id: z.uuid(),
  type: NotificationType,
  /** Rendered in the recipient's language when it was created. */
  title: z.string(),
  /** Plain text with line breaks. */
  body: z.string(),
  target: NotificationTarget.nullable(),
  workspaceId: z.uuid().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

/** Keyset paging: pass the `next` of the previous page as `before` + `beforeId`. */
export const NotificationListQuery = z
  .object({
    before: z.iso.datetime().optional(),
    beforeId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((q) => !q.beforeId || q.before, {
    message: 'beforeId needs before',
    path: ['beforeId'],
  });
export type NotificationListQuery = z.infer<typeof NotificationListQuery>;

export const NotificationList = z.object({
  items: z.array(NotificationDto),
  next: z.object({ before: z.iso.datetime(), beforeId: z.uuid() }).nullable(),
});
export type NotificationList = z.infer<typeof NotificationList>;

export const NotificationCount = z.object({ count: z.number().int().nonnegative() });
export type NotificationCount = z.infer<typeof NotificationCount>;

/** Web Push (T-190): the VAPID public key, null while push is not configured on the server. */
export const PushConfig = z.object({ publicKey: z.string().nullable() });
export type PushConfig = z.infer<typeof PushConfig>;

/** A browser `PushSubscription` (its JSON form), registered for the caller on this account. */
export const PushSubscriptionInput = z.object({
  endpoint: z.url().startsWith('https://').max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  userAgent: z.string().max(200).optional(),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;

export const PushSubscriptionRemove = z.object({ endpoint: z.string().max(1000) });
export type PushSubscriptionRemove = z.infer<typeof PushSubscriptionRemove>;

export const PushSubscriptionResult = z.object({ ok: z.literal(true) });
export type PushSubscriptionResult = z.infer<typeof PushSubscriptionResult>;
