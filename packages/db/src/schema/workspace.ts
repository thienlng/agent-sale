import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './identity.js';

/**
 * RLS predicate shared by every tenant table (InitPlan form, ADR-004).
 * Policies are role-scoped: `app_tenant` gets this predicate, `app_system` sees
 * all rows. Migrations are hand-written; these declarations mirror them.
 */
export const tenantPredicate = sql`workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid)`;

export function tenantPolicies(table: string) {
  return [
    pgPolicy(`${table}_tenant`, {
      for: 'all',
      to: 'app_tenant',
      using: tenantPredicate,
      withCheck: tenantPredicate,
    }),
    pgPolicy(`${table}_system`, {
      for: 'all',
      to: 'app_system',
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ];
}

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
  (t) => [index('workspaces_owner_idx').on(t.ownerUserId), ...tenantPolicies('workspaces')],
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
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    index('members_workspace_user_idx').on(t.workspaceId, t.userId),
    ...tenantPolicies('members'),
  ],
);

/** Invitation links (0014): only the hash of the link secret is stored. */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    email: text('email').notNull(),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: uuid('invited_by_user_id'),
    invitedByName: text('invited_by_name'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: uuid('accepted_by_user_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [...tenantPolicies('invitations')],
);
