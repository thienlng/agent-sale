import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantPolicies, workspaces } from './workspace.js';
export const channelConnections = pgTable(
  'channel_connections',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('connected'),
    /** Same-workspace bot only: composite key to bots(workspace_id, id), set null on delete (0028). */
    botId: uuid('bot_id'),
    tokenSealed: text('token_sealed').notNull(),
    /** Provider-specific settings (0025): the widget configuration of a website connection. */
    settings: jsonb('settings'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Who connected the page through Facebook Login (0078): SHA-256 hex of `facebook:<app-scoped
     * user id>`, for Meta's data deletion callback. Null before 0078, for Instagram and website.
     */
    metaUserHash: text('meta_user_hash'),
  },
  (t) => [
    index('channel_connections_meta_user_idx')
      .on(t.metaUserHash)
      .where(sql`${t.metaUserHash} is not null`),
    // A removed page (T-133) no longer owns its provider identity: only live rows are unique (0034).
    uniqueIndex('channel_connections_live_external_key')
      .on(t.provider, t.externalId)
      .where(sql`${t.status} <> 'removed'`),
    index('channel_workspace_idx').on(t.workspaceId),
    ...tenantPolicies('channel_connections'),
  ],
);
export const channelOauthFlows = pgTable(
  'channel_oauth_flows',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id').notNull(),
    provider: text('provider').notNull(),
    stateHash: text('state_hash').notNull(),
    browserHash: text('browser_hash').notNull(),
    accountsSealed: text('accounts_sealed'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('channel_state_unique').on(t.stateHash),
    ...tenantPolicies('channel_oauth_flows'),
  ],
);
/** Persisted verified ingress, processed asynchronously by the agent process. */
export const channelWebhookEvents = pgTable(
  'channel_webhook_events',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    externalId: text('external_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Dead letter (0013): attempts exhausted without delivery to the inbox; set with processedAt. */
    failedAt: timestamp('failed_at', { withTimezone: true }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    claimToken: uuid('claim_token'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('channel_webhook_dedup').on(t.connectionId, t.externalId),
    ...tenantPolicies('channel_webhook_events'),
  ],
);

/**
 * GLOBAL (0078, app_system only): Meta data deletion requests. `user_hash` (see
 * `channel_connections.meta_user_hash`) is kept only while pending; no personal data otherwise.
 */
export const metaDataDeletionRequests = pgTable(
  'meta_data_deletion_requests',
  {
    id: uuid('id').primaryKey(),
    confirmationCode: text('confirmation_code').notNull().unique(),
    userHash: text('user_hash'),
    status: text('status').$type<'pending' | 'completed'>().notNull().default('pending'),
    connectionsRemoved: integer('connections_removed').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('meta_data_deletion_requests_pending_user_idx')
      .on(t.userHash)
      .where(sql`${t.status} = 'pending'`),
    index('meta_data_deletion_requests_pending_idx')
      .on(t.requestedAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);
