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
  },
  (t) => [
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
