import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
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
  },
  (t) => [
    uniqueIndex('conversation_customer_unique').on(t.workspaceId, t.channelId, t.customerId),
    index('conversation_workspace_idx').on(t.workspaceId, t.updatedAt),
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
