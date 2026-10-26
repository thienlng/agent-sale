import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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

/** Additive training materials, separate from searchable FAQ entries. */
export const trainingItems = pgTable(
  'training_items',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    trigger: text('trigger').notNull().default(''),
    notes: text('notes').notNull().default(''),
    mediaUrl: text('media_url'),
    /** Media only: the `media_folder` training item that holds it (migration 0012). */
    folderId: uuid('folder_id').references((): AnyPgColumn => trainingItems.id, {
      onDelete: 'cascade',
    }),
    /** Scenarios only: a disabled rule is kept but not given to the model (migration 0016). */
    enabled: boolean('enabled').notNull().default(true),
    /** Scenarios only: `general` | `after_order` (migration 0016). */
    section: text('section').notNull().default('general'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('training_items_bot_idx').on(t.workspaceId, t.botId),
    ...tenantPolicies('training_items'),
  ],
);
export const trainingHistory = pgTable(
  'training_history',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull(),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull().default(''),
    changes: jsonb('changes').notNull().default([]),
    /** The training item before the change; null for settings, FAQs and creations. */
    snapshot: jsonb('snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('training_history_bot_idx').on(t.workspaceId, t.botId, t.createdAt),
    ...tenantPolicies('training_history'),
  ],
);
