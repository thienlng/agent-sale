import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantPolicies, workspaces } from './workspace.js';
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    channelId: uuid('channel_id').notNull(),
    customerId: text('customer_id').notNull(),
    data: jsonb('data').notNull().$type<Record<string, unknown>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Index columns derived from `data` on every save (migration 0024); `data` stays the document.
    unreadCount: integer('unread_count').notNull().default(0),
    awaitingSince: timestamp('awaiting_since', { withTimezone: true }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    assigneeId: uuid('assignee_id'),
    mode: text('mode'),
    status: text('status'),
    customerPhone: text('customer_phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Bot currently answering (0028): the channel's bot, updated on rebind. Same-workspace key. */
    botId: uuid('bot_id'),
  },
  (t) => [
    uniqueIndex('conversation_customer_unique').on(t.workspaceId, t.channelId, t.customerId),
    index('conversation_workspace_idx').on(t.workspaceId, t.updatedAt),
    index('conversation_unread_idx')
      .on(t.workspaceId, t.updatedAt)
      .where(sql`${t.unreadCount} > 0`),
    index('conversation_waiting_idx')
      .on(t.workspaceId, t.awaitingSince)
      .where(sql`${t.awaitingSince} is not null`),
    index('conversation_assignee_idx')
      .on(t.workspaceId, t.assigneeId)
      .where(sql`${t.assigneeId} is not null`),
    ...tenantPolicies('conversations'),
  ],
);
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    data: jsonb('data').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversation_message_dedup').on(t.workspaceId, t.conversationId, t.idempotencyKey),
    index('conversation_messages_idx').on(t.workspaceId, t.conversationId, t.createdAt),
    ...tenantPolicies('conversation_messages'),
  ],
);
