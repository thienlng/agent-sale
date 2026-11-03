import { z } from 'zod';

/** In-app notifications of the current user (T-172). */

export const NotificationType = z.enum([
  'assistant.report',
  'assistant.alert',
  'assistant.schedule_paused',
]);
export type NotificationType = z.infer<typeof NotificationType>;

/** Where a click goes: a dashboard path, or the assistant thread of a report run. */
export const NotificationTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().max(300) }),
  z.object({ kind: z.literal('assistant_report'), runId: z.uuid() }),
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
