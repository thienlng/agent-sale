import {
  bigint,
  boolean,
  index,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';

import { accounts } from './account.js';
import { users } from './identity.js';
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
    /** Plan catalog editor (0053, ADR-021): an edit inserts the next version. */
    description: text('description').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Hidden from new sales; current subscribers keep it. */
    archivedAt: ts('archived_at'),
    createdBy: uuid('created_by').references(() => users.id),
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

/**
 * GLOBAL (migration 0031, ADR-012 §5): the account's plan. System role only. Allowance cycles start
 * at `cycleAnchor` and repeat every `ai.included_messages.periodDays` days.
 */
export const accountSubscriptions = pgTable(
  'account_subscriptions',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id),
    planCode: text('plan_code').notNull(),
    planVersion: integer('plan_version').notNull(),
    periodMonths: integer('period_months'),
    status: text('status').notNull().default('active'),
    currentPeriodStart: ts('current_period_start').notNull().defaultNow(),
    currentPeriodEnd: ts('current_period_end'),
    cycleAnchor: ts('cycle_anchor').notNull().defaultNow(),
    sourceWorkspaceId: uuid('source_workspace_id').references(() => workspaces.id),
    /** When `status` last changed (0053): the lifecycle job counts grace days from here. */
    statusChangedAt: ts('status_changed_at').notNull().defaultNow(),
    /** Reminder keys already sent for the current period (0053), e.g. `{"trial_ending:3": "<iso>"}`. */
    remindersSent: jsonb('reminders_sent').notNull().default({}).$type<Record<string, string>>(),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.planCode, t.planVersion],
      foreignColumns: [plans.code, plans.version],
    }),
  ],
);

/** GLOBAL (0031): account-wide add-ons and deals; replace the plan's value for one key. */
export const accountEntitlementOverrides = pgTable(
  'account_entitlement_overrides',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    key: text('key').notNull(),
    value: jsonb('value').notNull().$type<unknown>(),
    reason: text('reason').notNull().default(''),
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.key] })],
);

/**
 * GLOBAL (0031): one row per AI reply to a customer, keyed by the outbound idempotency key.
 * `reserved` before the model runs, `captured` when delivered, `released` otherwise.
 */
export const messageUsage = pgTable(
  'message_usage',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    idempotencyKey: text('idempotency_key').notNull(),
    cycleStart: ts('cycle_start').notNull(),
    status: text('status').notNull().$type<'reserved' | 'captured' | 'released'>(),
    conversationId: uuid('conversation_id'),
    botId: uuid('bot_id'),
    reservedAt: ts('reserved_at').notNull().defaultNow(),
    capturedAt: ts('captured_at'),
    releasedAt: ts('released_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.idempotencyKey] }),
    index('message_usage_cycle_idx')
      .on(t.accountId, t.cycleStart)
      .where(sql`status <> 'released'`),
  ],
);

/** GLOBAL (0053, ADR-021): platform billing settings, single row `id = 'default'`. System role only. */
export const billingSettings = pgTable('billing_settings', {
  id: text('id').primaryKey().default('default'),
  trialEnabled: boolean('trial_enabled').notNull().default(false),
  trialPlanCode: text('trial_plan_code'),
  trialDays: integer('trial_days'),
  afterTrialPlanCode: text('after_trial_plan_code').notNull().default('free'),
  hqContactScope: text('hq_contact_scope')
    .notNull()
    .default('owner')
    .$type<'owner' | 'owner_and_billing'>(),
  graceDays: integer('grace_days').notNull().default(7),
  suspendDays: integer('suspend_days').notNull().default(30),
  bankBin: text('bank_bin'),
  bankAccountNo: text('bank_account_no'),
  bankAccountName: text('bank_account_name'),
  version: integer('version').notNull().default(1),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** GLOBAL (0053): a manual payment request (VietQR transfer), confirmed by an operator. */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    /** Transfer content the customer types; unique, matched against the bank statement. */
    code: text('code').notNull().unique(),
    planCode: text('plan_code').notNull(),
    planVersion: integer('plan_version').notNull(),
    periodMonths: integer('period_months').notNull(),
    amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
    method: text('method').notNull().default('vietqr').$type<'vietqr'>(),
    status: text('status')
      .notNull()
      .default('pending')
      .$type<'pending' | 'confirmed' | 'canceled'>(),
    requestedBy: uuid('requested_by').references(() => users.id),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    confirmedAt: ts('confirmed_at'),
    bankReference: text('bank_reference'),
    note: text('note').notNull().default(''),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.planCode, t.planVersion],
      foreignColumns: [plans.code, plans.version],
    }),
    index('payments_account_idx').on(t.accountId, t.createdAt),
  ],
);
