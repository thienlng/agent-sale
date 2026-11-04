import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { accounts } from './account.js';
import { users } from './identity.js';
import { accountPolicies, workspaces } from './workspace.js';

/*
 * `notification` module (0061, T-172): in-app notifications and their email/push deliveries.
 * ACCOUNT-scoped (RLS on `app.account_id`, set by `withAccount`); every query also filters on
 * `user_id`. In-app delivery is the `notifications` row itself.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    params: jsonb('params').notNull().default({}),
    /** Rendered in the recipient's locale; ≤ 160 chars. */
    title: text('title').notNull(),
    /** Plain text with line breaks; ≤ 4 000 chars. */
    body: text('body').notNull(),
    /** `{kind:'path', path}` | `{kind:'assistant_report', runId}` | null. */
    target: jsonb('target'),
    dedupKey: text('dedup_key'),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'notifications_type_check',
      sql`${t.type} in ('assistant.report','assistant.alert','assistant.schedule_paused')`,
    ),
    check('notifications_title_check', sql`char_length(${t.title}) <= 160`),
    check('notifications_body_check', sql`char_length(${t.body}) <= 4000`),
    check('notifications_dedup_key_check', sql`char_length(${t.dedupKey}) <= 160`),
    index('notifications_list_idx').on(t.accountId, t.userId, t.createdAt.desc(), t.id.desc()),
    index('notifications_unread_idx')
      .on(t.accountId, t.userId)
      .where(sql`read_at is null`),
    uniqueIndex('notifications_dedup_unique')
      .on(t.userId, t.dedupKey)
      .where(sql`dedup_key is not null`),
    index('notifications_created_idx').on(t.createdAt),
    ...accountPolicies('notifications'),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    /** `email` | `push` (in-app is the notification row). */
    channel: text('channel').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    leaseUntil: ts('lease_until'),
    errorCode: text('error_code'),
    providerMessageId: text('provider_message_id'),
    sentAt: ts('sent_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('notification_deliveries_channel_check', sql`${t.channel} in ('email','push')`),
    check(
      'notification_deliveries_status_check',
      sql`${t.status} in ('queued','sending','sent','failed','skipped')`,
    ),
    unique('notification_deliveries_channel_unique').on(t.notificationId, t.channel),
    index('notification_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('notification_deliveries_sent_idx')
      .on(t.userId, t.channel, t.sentAt)
      .where(sql`status = 'sent'`),
    ...accountPolicies('notification_deliveries'),
  ],
);
