import {
  bigint,
  jsonb,
  primaryKey,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { contacts } from './crm.js';
import { tenantPolicies, workspaces } from './workspace.js';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);

/** One subscription per customer: plan, stage, MRR in VND, dates (0052, ADR-020). */
export const saasSubscriptions = pgTable(
  'saas_subscriptions',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    contactId: uuid('contact_id').notNull(),
    planName: text('plan_name').notNull(),
    stage: text('stage').notNull(),
    billingPeriod: text('billing_period').notNull(),
    mrr: bigint('mrr', { mode: 'number' }).notNull().default(0),
    seats: integer('seats'),
    trialEndsOn: date('trial_ends_on', { mode: 'string' }),
    startedOn: date('started_on', { mode: 'string' }),
    renewsOn: date('renews_on', { mode: 'string' }),
    canceledOn: date('canceled_on', { mode: 'string' }),
    externalRef: text('external_ref'),
    note: text('note').notNull().default(''),
    /** Per-workspace catalog plan (0054); MRR is computed from its period price. */
    planId: uuid('plan_id'),
    churnReason: text('churn_reason'),
    churnNote: text('churn_note').notNull().default(''),
    /** `rapiz` when the Rapiz HQ sync owns plan, stage, dates and MRR (ADR-021, 0054). */
    externalSource: text('external_source').$type<'rapiz'>(),
    usageUsed: integer('usage_used'),
    usageLimit: integer('usage_limit'),
    usageAt: ts('usage_at'),
    remindersSent: jsonb('reminders_sent').notNull().default({}).$type<Record<string, string>>(),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('saas_subscriptions_contact_unique').on(t.workspaceId, t.contactId),
    foreignKey({
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: 'saas_subscriptions_contact_fk',
    }).onDelete('cascade'),
    index('saas_subscriptions_stage_idx').on(t.workspaceId, t.stage),
    uniqueIndex('saas_subscriptions_external_ref_unique')
      .on(t.workspaceId, t.externalRef)
      .where(sql`external_ref is not null`),
    ...tenantPolicies('saas_subscriptions'),
  ],
);

/** Per-workspace plan catalog (0054, spec §6.1): price of a whole period in VND by billing period. */
export const saasPlans = pgTable(
  'saas_plans',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    name: text('name').notNull(),
    prices: jsonb('prices').notNull().default({}).$type<Record<string, number>>(),
    position: integer('position').notNull().default(0),
    archivedAt: ts('archived_at'),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('saas_plans_ws_id').on(t.workspaceId, t.id), ...tenantPolicies('saas_plans')],
);

/** One row per plan / stage / MRR change of a subscription (0054, spec §6.2). */
export const saasSubscriptionHistory = pgTable(
  'saas_subscription_history',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => saasSubscriptions.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').notNull(),
    fromStage: text('from_stage'),
    toStage: text('to_stage').notNull(),
    fromPlan: text('from_plan'),
    toPlan: text('to_plan').notNull(),
    fromMrr: bigint('from_mrr', { mode: 'number' }),
    toMrr: bigint('to_mrr', { mode: 'number' }).notNull(),
    churnReason: text('churn_reason'),
    source: text('source').notNull().$type<'staff' | 'sync' | 'system'>(),
    actorUserId: uuid('actor_user_id'),
    changedAt: ts('changed_at').notNull().defaultNow(),
  },
  (t) => [
    index('saas_subscription_history_sub_idx').on(t.workspaceId, t.subscriptionId, t.changedAt),
    ...tenantPolicies('saas_subscription_history'),
  ],
);

/** Rapiz HQ (ADR-021, 0054): a platform account linked to an HQ customer, last applied events. */
export const saasHqLinks = pgTable(
  'saas_hq_links',
  {
    workspaceId: workspaceRef(),
    accountId: uuid('account_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    applied: jsonb('applied').notNull().default({}).$type<Record<string, string>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.accountId] }),
    index('saas_hq_links_contact_idx').on(t.workspaceId, t.contactId),
    ...tenantPolicies('saas_hq_links'),
  ],
);

/** GLOBAL (0054): outbox position of the HQ consumer and the last reconcile. System role only. */
export const saasHqCheckpoints = pgTable('saas_hq_checkpoints', {
  consumer: text('consumer').primaryKey(),
  horizon: bigint('horizon', { mode: 'number' }).notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** GLOBAL (0054): outbox events the HQ consumer could not parse. */
export const saasHqDeadLetters = pgTable('saas_hq_dead_letters', {
  outboxId: bigint('outbox_id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),
  error: text('error').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});
