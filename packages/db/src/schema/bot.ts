import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenantPolicies, workspaces } from './workspace.js';

/** Tenant table (migration 0002). `settings` is validated by contracts BotSettings. */
export const bots = pgTable(
  'bots',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    industry: text('industry').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    settings: jsonb('settings').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('bots_workspace_idx').on(t.workspaceId, t.createdAt), ...tenantPolicies('bots')],
);
