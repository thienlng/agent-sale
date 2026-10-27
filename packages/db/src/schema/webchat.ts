import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantPolicies, workspaces } from './workspace.js';

/**
 * One row per website visitor who wrote at least once (0026). `id` doubles as the conversation's
 * `customer_id`. No IP or user agent is stored.
 */
export const webchatVisitors = pgTable(
  'webchat_visitors',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    connectionId: uuid('connection_id').notNull(),
    conversationId: uuid('conversation_id'),
    firstUrl: text('first_url'),
    referrer: text('referrer'),
    lastUrl: text('last_url'),
    lastTitle: text('last_title'),
    phoneE164: text('phone_e164'),
    contactId: uuid('contact_id'),
    phoneCapturedAt: timestamp('phone_captured_at', { withTimezone: true }),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('webchat_visitors_connection_id_unique').on(t.connectionId, t.id),
    index('webchat_visitors_conversation_idx').on(t.workspaceId, t.conversationId),
    ...tenantPolicies('webchat_visitors'),
  ],
);
