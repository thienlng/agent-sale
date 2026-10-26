import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { bots } from './bot.js';
import { tenantPolicies, workspaces } from './workspace.js';

/** Tenant table (migration 0015). An HTTP API the bot may call; the secret is sealed (SecretBox). */
export const botActions = pgTable(
  'bot_actions',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    url: text('url').notNull(),
    method: text('method').notNull(),
    params: jsonb('params').notNull().default([]),
    responses: jsonb('responses').notNull().default([]),
    authKind: text('auth_kind').notNull().default('none'),
    authHeaderName: text('auth_header_name'),
    /** SecretBox-sealed API key / bearer token; never selected into a DTO. */
    authSecretEnc: text('auth_secret_enc'),
    requiresConfirm: boolean('requires_confirm').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bot_actions_bot_idx').on(t.workspaceId, t.botId),
    ...tenantPolicies('bot_actions'),
  ],
);

/** One row per executed call. Deliberately no arguments and no response body (PII). */
export const actionRuns = pgTable(
  'action_runs',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    actionId: uuid('action_id')
      .notNull()
      .references(() => botActions.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id'),
    statusCode: integer('status_code'),
    ok: boolean('ok').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    errorCode: text('error_code'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('action_runs_action_idx').on(t.workspaceId, t.actionId, t.createdAt),
    ...tenantPolicies('action_runs'),
  ],
);

/** The write call awaiting the customer's confirmation: one per conversation, short TTL. */
export const actionPending = pgTable(
  'action_pending',
  {
    conversationId: uuid('conversation_id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    actionId: uuid('action_id')
      .notNull()
      .references(() => botActions.id, { onDelete: 'cascade' }),
    args: jsonb('args').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('action_pending_expiry_idx').on(t.expiresAt), ...tenantPolicies('action_pending')],
);
