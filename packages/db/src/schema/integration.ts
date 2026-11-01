import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenantPolicies, workspaces } from './workspace.js';

/** Tenant tables of migration 0040: the PMS sync (ADR-017). */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' });

export type IntegrationProvider = 'kiotviet';
export type IntegrationConnectionStatus = 'connected' | 'syncing' | 'error' | 'disconnected';
export type IntegrationJobKind =
  'full_import' | 'reconcile' | 'webhook' | 'push_order' | 'customer_import';
export type IntegrationLogLevel = 'info' | 'warning' | 'error';

/** One PMS account linked to a workspace; at most one live row per provider. */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    provider: text('provider').$type<IntegrationProvider>().notNull(),
    status: text('status').$type<IntegrationConnectionStatus>().notNull(),
    retailer: text('retailer').notNull(),
    clientId: text('client_id').notNull(),
    clientSecretSealed: text('client_secret_sealed').notNull(),
    /** Path token of the public webhook URL; unique across workspaces. */
    webhookToken: text('webhook_token').notNull().unique(),
    webhookSecretSealed: text('webhook_secret_sealed').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
    version: integer('version').notNull().default(1),
    progress: jsonb('progress').$type<Record<string, unknown> | null>(),
    counts: jsonb('counts').$type<Record<string, unknown>>().notNull().default({}),
    lastError: jsonb('last_error').$type<Record<string, unknown> | null>(),
    lastFullSyncAt: ts('last_full_sync_at'),
    lastReconcileAt: ts('last_reconcile_at'),
    connectedByUserId: uuid('connected_by_user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    disconnectedAt: ts('disconnected_at'),
  },
  (t) => [
    check('integration_connections_provider_check', sql`${t.provider} in ('kiotviet')`),
    check(
      'integration_connections_status_check',
      sql`${t.status} in ('connected','syncing','error','disconnected')`,
    ),
    uniqueIndex('integration_connections_live')
      .on(t.workspaceId, t.provider)
      .where(sql`${t.status} <> 'disconnected'`),
    ...tenantPolicies('integration_connections'),
  ],
);

/** Leased background work: one open sync job per connection. */
export const integrationJobs = pgTable(
  'integration_jobs',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<IntegrationJobKind>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    cursor: jsonb('cursor').$type<Record<string, unknown> | null>(),
    runAfter: ts('run_after').notNull().defaultNow(),
    leaseUntil: ts('lease_until'),
    claimToken: uuid('claim_token'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    doneAt: ts('done_at'),
    failedAt: ts('failed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'integration_jobs_kind_check',
      sql`${t.kind} in ('full_import','reconcile','webhook','push_order','customer_import')`,
    ),
    index('integration_jobs_ready')
      .on(t.runAfter)
      .where(sql`${t.doneAt} is null and ${t.failedAt} is null`),
    uniqueIndex('integration_jobs_one_sync')
      .on(t.connectionId)
      .where(
        sql`${t.kind} in ('full_import','reconcile') and ${t.doneAt} is null and ${t.failedAt} is null`,
      ),
    index('integration_jobs_push_order_idx')
      .on(t.workspaceId, sql`(${t.payload} ->> 'orderId')`, t.createdAt.desc())
      .where(sql`${t.kind} = 'push_order'`),
    uniqueIndex('integration_jobs_one_push_per_order')
      .on(t.workspaceId, sql`(${t.payload} ->> 'orderId')`)
      .where(sql`${t.kind} = 'push_order' and ${t.doneAt} is null and ${t.failedAt} is null`),
    ...tenantPolicies('integration_jobs'),
  ],
);

/** Raw webhook deliveries, deduplicated per connection. */
export const integrationWebhookEvents = pgTable(
  'integration_webhook_events',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'cascade' }),
    deliveryId: text('delivery_id').notNull(),
    body: text('body').notNull(),
    signature: text('signature'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [
    unique().on(t.connectionId, t.deliveryId),
    index('integration_webhook_events_open')
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
    ...tenantPolicies('integration_webhook_events'),
  ],
);

/** PMS picture URL → our stored copy, so a re-sync never uploads a picture twice. */
export const integrationImageCache = pgTable(
  'integration_image_cache',
  {
    workspaceId: workspaceRef(),
    sourceUrl: text('source_url').notNull(),
    storedUrl: text('stored_url').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.sourceUrl] }),
    ...tenantPolicies('integration_image_cache'),
  ],
);

/** Owner-visible sync history: a code plus params, rendered by the web app's i18n. */
export const integrationSyncLog = pgTable(
  'integration_sync_log',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'cascade' }),
    level: text('level').$type<IntegrationLogLevel>().notNull(),
    code: text('code').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [
    check('integration_sync_log_level_check', sql`${t.level} in ('info','warning','error')`),
    index('integration_sync_log_recent').on(t.connectionId, t.at.desc()),
    ...tenantPolicies('integration_sync_log'),
  ],
);
