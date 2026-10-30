import { sql } from 'drizzle-orm';
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
import { users } from './identity.js';
import { tenantPolicies, workspaces } from './workspace.js';

/** Tenant table (migration 0003). One row per LLM turn: metering + retrieved sources. */
export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id'),
    tier: text('tier').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cachedTokens: integer('cached_tokens').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    retrieved: jsonb('retrieved').notNull().default([]),
    productIds: jsonb('product_ids').$type<string[]>().notNull().default([]),
    outcome: text('outcome').notNull(),
    guardrail: text('guardrail'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_runs_workspace_idx').on(t.workspaceId, t.createdAt),
    index('ai_runs_bot_idx').on(t.workspaceId, t.botId, t.createdAt),
    index('ai_runs_conversation_recent_idx')
      .on(t.workspaceId, t.conversationId, t.createdAt.desc())
      .where(sql`${t.conversationId} is not null`),
    ...tenantPolicies('ai_runs'),
  ],
);

/** GLOBAL (migration 0003, app_system only). An LLM server; `api_key_cipher` is AES-256-GCM. */
export const llmProviders = pgTable('llm_providers', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  kind: text('kind').notNull(),
  baseUrl: text('base_url'),
  apiKeyCipher: text('api_key_cipher'),
  apiKeyHint: text('api_key_hint'),
  options: jsonb('options').notNull().default({}),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** GLOBAL (migration 0003, app_system only). Which provider/model serves each commercial tier. */
export const llmTierRoutes = pgTable('llm_tier_routes', {
  tier: text('tier').primaryKey(),
  providerId: uuid('provider_id')
    .notNull()
    .references(() => llmProviders.id),
  model: text('model').notNull(),
  effort: text('effort'),
  fallbackProviderId: uuid('fallback_provider_id').references(() => llmProviders.id),
  fallbackModel: text('fallback_model'),
  fallbackEffort: text('fallback_effort'),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
