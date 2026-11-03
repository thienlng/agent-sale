import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './identity.js';
import { tenantPolicies, workspaces } from './workspace.js';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);

/** Webhook endpoints of a workspace (0055, ADR-022 §5). */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    url: text('url').notNull(),
    description: text('description').notNull().default(''),
    /** Public event types (`PUBLIC_EVENT_TYPES`). */
    events: text('events')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** `whsec_…` sealed with SecretBox. */
    secretEncrypted: text('secret_encrypted').notNull(),
    /** The secret before the last rotation; also signs until `previousSecretExpiresAt`. */
    previousSecretEncrypted: text('previous_secret_encrypted'),
    previousSecretExpiresAt: ts('previous_secret_expires_at'),
    enabled: boolean('enabled').notNull().default(true),
    disabledReason: text('disabled_reason').$type<'failing' | 'manual'>(),
    /** First failed delivery since the last success. */
    failingSince: ts('failing_since'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('webhook_endpoints_ws_id').on(t.workspaceId, t.id),
    ...tenantPolicies('webhook_endpoints'),
  ],
);

/** One public event for one endpoint; `eventId` is the envelope id, stable across retries. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    endpointId: uuid('endpoint_id').notNull(),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    /** The envelope as sent. */
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    status: text('status').notNull().default('pending').$type<'pending' | 'succeeded' | 'failed'>(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at'),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    deliveredAt: ts('delivered_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.endpointId],
      foreignColumns: [webhookEndpoints.workspaceId, webhookEndpoints.id],
    }).onDelete('cascade'),
    unique('webhook_deliveries_endpoint_event').on(t.endpointId, t.eventId),
    index('webhook_deliveries_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`status = 'pending'`),
    index('webhook_deliveries_endpoint_idx').on(
      t.workspaceId,
      t.endpointId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    ...tenantPolicies('webhook_deliveries'),
  ],
);

/** GLOBAL (0055): outbox position of the webhook dispatcher. System role only. */
export const webhookCheckpoints = pgTable('webhook_checkpoints', {
  consumer: text('consumer').primaryKey(),
  horizon: bigint('horizon', { mode: 'number' }).notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
