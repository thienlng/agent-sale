import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './identity.js';

/** RLS predicate shared by every tenant table (InitPlan form, ADR-004). */
export const tenantPredicate = sql`workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)`;
export const systemPredicate = sql`current_setting('app.role', true) = 'system'`;

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey(),
    /** Self-reference so the same predicate works on the root tenant table. */
    workspaceId: uuid('workspace_id').notNull(),
    name: text('name').notNull(),
    industry: text('industry').notNull(),
    timezone: text('timezone').notNull().default('Asia/Ho_Chi_Minh'),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('workspaces_owner_idx').on(t.ownerUserId),
    pgPolicy('workspaces_tenant', {
      for: 'all',
      using: sql`${tenantPredicate} or ${systemPredicate}`,
    }),
  ],
);

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('members_workspace_user_idx').on(t.workspaceId, t.userId),
    pgPolicy('members_tenant', {
      for: 'all',
      using: sql`${tenantPredicate} or ${systemPredicate}`,
    }),
  ],
);
