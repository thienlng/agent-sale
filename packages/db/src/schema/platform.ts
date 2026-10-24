import { sql } from 'drizzle-orm';
import {
  bigserial,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** A 64-bit transaction id; read it as text (`tx_id::text`), compare it in SQL. */
const xid8 = customType<{ data: string }>({ dataType: () => 'xid8' });

/** GLOBAL: where each workspace's data lives (docs/17 §6). All rows point to 'primary' until a dedicated DB exists. */
export const tenantRoutes = pgTable('tenant_routes', {
  workspaceId: uuid('workspace_id').primaryKey(),
  databaseKey: text('database_key').notNull().default('primary'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Transactional outbox (docs/ARCHITECTURE.md §2): integration events are written
 * in the same transaction as the business row and published by the worker.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id'),
    type: text('type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** The writing transaction (migration 0022): consumers read by transaction horizon, not by id. */
    txId: xid8('tx_id')
      .notNull()
      .default(sql`pg_current_xact_id()`),
  },
  (t) => [index('outbox_events_tx_idx').on(t.txId)],
);

/** Idempotent inbox for consumers: (consumer, event id) processed at most once. */
export const inboxEvents = pgTable('inbox_events', {
  consumer: text('consumer').notNull(),
  eventId: text('event_id').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
