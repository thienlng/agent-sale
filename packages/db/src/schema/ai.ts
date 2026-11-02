import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
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

/** `ai_run_traces.loop_outcome` values (migration 0062). */
export type AiLoopOutcome = 'done' | 'interrupted' | 'limit' | 'invalid_tools' | 'budget' | 'error';

/**
 * Tenant table (migration 0062). One row per `ai_runs` row written since T-174: what the shop
 * bot saw and how its loop ended. Excerpts are redacted; kept 30 days (AiTraceRunner).
 */
export const aiRunTraces = pgTable(
  'ai_run_traces',
  {
    runId: uuid('run_id')
      .primaryKey()
      .references(() => aiRuns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    channel: text('channel'),
    commentReply: boolean('comment_reply').notNull().default(false),
    historyTurns: smallint('history_turns').notNull().default(0),
    historySummarized: boolean('history_summarized').notNull().default(false),
    customerImages: smallint('customer_images').notNull().default(0),
    queryExcerpt: text('query_excerpt'),
    replyExcerpt: text('reply_excerpt'),
    scenarioIds: jsonb('scenario_ids').$type<string[]>().notNull().default([]),
    focusProductIds: jsonb('focus_product_ids').$type<string[]>().notNull().default([]),
    actionIds: jsonb('action_ids').$type<string[]>().notNull().default([]),
    pendingAction: boolean('pending_action').notNull().default(false),
    offeredTools: text('offered_tools')
      .array()
      .notNull()
      .default(sql`'{}'`),
    systemPromptSha: char('system_prompt_sha', { length: 64 }).notNull(),
    situationsSha: char('situations_sha', { length: 64 }).notNull(),
    modelCalls: smallint('model_calls').notNull().default(0),
    loopOutcome: text('loop_outcome').$type<AiLoopOutcome>().notNull(),
    messagesSent: smallint('messages_sent').notNull().default(0),
    messagesUndelivered: smallint('messages_undelivered').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ai_run_traces_query_excerpt_check', sql`char_length(${t.queryExcerpt}) <= 300`),
    check('ai_run_traces_reply_excerpt_check', sql`char_length(${t.replyExcerpt}) <= 300`),
    index('ai_run_traces_bot_idx').on(t.workspaceId, t.botId, t.createdAt.desc()),
    index('ai_run_traces_conversation_idx')
      .on(t.workspaceId, t.conversationId, t.createdAt.desc())
      .where(sql`${t.conversationId} is not null`),
    index('ai_run_traces_created_idx').on(t.createdAt),
    ...tenantPolicies('ai_run_traces'),
  ],
);

/** Tenant table (migration 0062). The loop steps of a traced turn, in order; `detail` is allowlisted. */
export const aiRunSteps = pgTable(
  'ai_run_steps',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => aiRuns.id, { onDelete: 'cascade' }),
    idx: smallint('idx').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    kind: text('kind').notNull(),
    toolName: text('tool_name'),
    ok: boolean('ok'),
    errorCode: text('error_code'),
    ms: integer('ms'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.idx] }),
    index('ai_run_steps_created_idx').on(t.createdAt),
    ...tenantPolicies('ai_run_steps'),
  ],
);

/** Tenant table (migration 0037). Summary of the older turns of a long conversation. */
export const conversationSummaries = pgTable(
  'conversation_summaries',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    conversationId: uuid('conversation_id').notNull(),
    coveredUntil: timestamp('covered_until', { withTimezone: true }).notNull(),
    summary: text('summary').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.conversationId] }),
    ...tenantPolicies('conversation_summaries'),
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
