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
    botId: uuid('bot_id'),
    tokenSealed: text('token_sealed').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('channel_asset_unique').on(t.provider, t.externalId),
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
