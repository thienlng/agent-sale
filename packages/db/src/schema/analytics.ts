import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenantPolicies, workspaces } from './workspace.js';

/**
 * Tenant table (migration 0021): one row per (outbox event, fact kind), derived by the analytics
 * projector. Ids and times only: no names, phone numbers or message text.
 */
export const analyticsFacts = pgTable(
  'analytics_facts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    outboxId: bigint('outbox_id', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    origin: text('origin').notNull(),
    contactId: uuid('contact_id'),
    conversationId: uuid('conversation_id'),
    channelId: uuid('channel_id'),
    subjectId: uuid('subject_id'),
    fromSubjectId: uuid('from_subject_id'),
    refId: uuid('ref_id'),
    role: text('role'),
    /** Bot bound to the channel when the fact happened (0028); kept when the page is rebound. */
    botId: uuid('bot_id'),
  },
  (t) => [
    // Names as Postgres gave them in migration 0021.
    unique('analytics_facts_workspace_id_outbox_id_kind_key').on(t.workspaceId, t.outboxId, t.kind),
    index('analytics_facts_kind_time_idx').on(t.workspaceId, t.kind, t.occurredAt),
    index('analytics_facts_contact_idx')
      .on(t.workspaceId, t.contactId, t.kind, t.occurredAt.desc())
      .where(sql`${t.contactId} is not null`),
    index('analytics_facts_ref_idx')
      .on(t.workspaceId, t.refId)
      .where(sql`${t.refId} is not null`),
    ...tenantPolicies('analytics_facts'),
  ],
);

/**
 * GLOBAL (app_system only): where the projector stopped, per consumer. `horizon` is a transaction
 * horizon (xid8): every transaction below it had finished when the projector last read, so every
 * outbox row it wrote has been projected.
 */
export const analyticsCheckpoints = pgTable('analytics_checkpoints', {
  consumer: text('consumer').primaryKey(),
  horizon: bigint('horizon', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** GLOBAL (app_system only): outbox events the projector could not parse. */
export const analyticsDeadLetters = pgTable('analytics_dead_letters', {
  outboxId: bigint('outbox_id', { mode: 'number' }).primaryKey(),
  workspaceId: uuid('workspace_id'),
  type: text('type').notNull(),
  error: text('error').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
