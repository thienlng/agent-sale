import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bots } from './bot.js';
import { tenantPolicies, workspaces } from './workspace.js';

/** Tenant table (migration 0002). FAQ entries; `search_text` is folded text for trigram search. */
export const knowledgeItems = pgTable(
  'knowledge_items',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    type: text('type').notNull().default('faq'),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    searchText: text('search_text').notNull(),
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('knowledge_items_bot_idx').on(t.workspaceId, t.botId),
    ...tenantPolicies('knowledge_items'),
  ],
);
