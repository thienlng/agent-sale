import { defineRoutes } from '../common/routes.js';
import {
  NotificationCount,
  NotificationDto,
  NotificationList,
  NotificationListQuery,
} from './notification.schema.js';

/**
 * The caller's own notifications (T-172, 3-P5). The current business gives the account; a user
 * only ever sees their own rows, another user's id answers 404.
 */
const scoped = {
  tag: 'notification',
  auth: true,
  workspaceScoped: true,
  assistant: { use: 'never' },
} as const;
export const notificationRoutes = defineRoutes([
  {
    ...scoped,
    method: 'get',
    path: '/notifications',
    summary: "The caller's notifications, newest first (keyset paging)",
    query: NotificationListQuery,
    responses: { 200: NotificationList },
  },
  {
    ...scoped,
    method: 'get',
    path: '/notifications/unread-count',
    summary: "How many of the caller's notifications are unread",
    responses: { 200: NotificationCount },
  },
  {
    ...scoped,
    method: 'post',
    path: '/notifications/{notificationId}/read',
    summary: 'Mark one notification read',
    responses: { 200: NotificationDto },
  },
  {
    ...scoped,
    method: 'post',
    path: '/notifications/read-all',
    summary: "Mark all the caller's notifications read; returns how many changed",
    responses: { 200: NotificationCount },
  },
]);
