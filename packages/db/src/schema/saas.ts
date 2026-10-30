import {
  bigint,
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

/** Demo / trial / consultation requests of a SaaS business (0036, ADR-014). */
export const saasRequests = pgTable(
  'saas_requests',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    clientRequestId: uuid('client_request_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('new'),
    source: text('source').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    company: text('company').notNull().default(''),
    teamSize: text('team_size').notNull().default(''),
    need: text('need').notNull().default(''),
    preferredTime: text('preferred_time').notNull().default(''),
    planInterest: text('plan_interest').notNull().default(''),
    contactId: uuid('contact_id'),
    conversationId: uuid('conversation_id'),
    note: text('note').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('saas_requests_request_unique').on(t.workspaceId, t.clientRequestId),
    foreignKey({
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
      name: 'saas_requests_contact_fk',
    }),
    index('saas_requests_status_idx').on(t.workspaceId, t.status, t.createdAt.desc()),
    index('saas_requests_contact_idx')
      .on(t.workspaceId, t.contactId)
      .where(sql`contact_id is not null`),
    ...tenantPolicies('saas_requests'),
  ],
);

/** One subscription per customer: plan, stage, MRR in VND, dates (0036, ADR-014). */
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
