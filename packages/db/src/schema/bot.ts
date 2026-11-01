import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
    /** 'all' sells every active product; 'selected' only the bot_products rows (0029). */
    catalogMode: text('catalog_mode').notNull().default('all').$type<'all' | 'selected'>(),
    settings: jsonb('settings').notNull().$type<Record<string, unknown>>(),
    /** "Chốt đơn" (0039): kept out of `settings`; null fee means "shop báo sau". */
    orderTaking: boolean('order_taking').notNull().default(false),
    orderShippingFeeVnd: bigint('order_shipping_fee_vnd', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('bots_workspace_idx').on(t.workspaceId, t.createdAt),
    // Target of the same-workspace keys from channels and conversations (0028).
    uniqueIndex('bots_workspace_id_unique').on(t.workspaceId, t.id),
    ...tenantPolicies('bots'),
  ],
);
