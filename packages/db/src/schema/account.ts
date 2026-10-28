import { sql } from 'drizzle-orm';
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './identity.js';

/**
 * GLOBAL (no workspace_id, no RLS): the commercial owner of one or more businesses
 * (ADR-012, migration 0028). Only app_system may access it, through the `account` module.
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** GLOBAL: who may act for an account (`owner` | `billing`). Paying grants no business access. */
export const accountMembers = pgTable(
  'account_members',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.userId] }),
    index('account_members_user_idx')
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
  ],
);
