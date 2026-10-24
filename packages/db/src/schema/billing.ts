import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenantPolicies, workspaces } from './workspace.js';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Global plan catalog (migration 0015): system role only. */
export const plans = pgTable(
  'plans',
  {
    code: text('code').notNull(),
    version: integer('version').notNull().default(1),
    name: text('name').notNull(),
    isPublic: boolean('is_public').notNull().default(true),
    priceByPeriod: jsonb('price_by_period').notNull().default({}).$type<Record<string, number>>(),
    entitlements: jsonb('entitlements').notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.code, t.version] })],
);

/** Tenant tables (0015). A workspace without a subscription row is on the free plan. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id),
    planCode: text('plan_code').notNull(),
    planVersion: integer('plan_version').notNull(),
    periodMonths: integer('period_months'),
    status: text('status').notNull().default('active'),
    currentPeriodStart: ts('current_period_start').notNull().defaultNow(),
    currentPeriodEnd: ts('current_period_end'),
    version: integer('version').notNull().default(1),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.planCode, t.planVersion],
      foreignColumns: [plans.code, plans.version],
    }),
    ...tenantPolicies('subscriptions'),
  ],
);

export const workspaceEntitlementOverrides = pgTable(
  'workspace_entitlement_overrides',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    key: text('key').notNull(),
    value: jsonb('value').notNull().$type<unknown>(),
    reason: text('reason').notNull().default(''),
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.key] }),
    ...tenantPolicies('workspace_entitlement_overrides'),
  ],
);
