import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { accounts } from './account.js';
import { users } from './identity.js';
import { accountPolicies, workspaces } from './workspace.js';

/*
 * Owner assistant (0055 and 0056, ADR-022). ACCOUNT-scoped, not workspace-scoped: every row carries
 * `account_id` and RLS reads `app.account_id`, set by `withAccount`. `assistant_messages.search`
 * (a generated tsvector) and its GIN/trigram indexes exist only in SQL; repositories query them
 * with `sql`, so Drizzle never selects or writes the generated column.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });
const accountRef = () =>
  uuid('account_id')
    .notNull()
    .references(() => accounts.id);

export const assistantThreads = pgTable(
  'assistant_threads',
  {
    id: uuid('id').primaryKey(),
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull().default(''),
    origin: text('origin').notNull().default('chat'),
    businessId: uuid('business_id').references(() => workspaces.id),
    pinned: boolean('pinned').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    systemPrompt: text('system_prompt').notNull(),
    promptVersion: text('prompt_version').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastMessageAt: ts('last_message_at').notNull().defaultNow(),
    /** Prompt-cache key root; set on the first compaction and never changed after. */
    cacheRootId: uuid('cache_root_id'),
    compactedAt: ts('compacted_at'),
    compactionFailedAt: ts('compaction_failed_at'),
    /** Savings (%) of the last two compactions, for the anti-thrash rule. */
    compactionSavedPcts: real('compaction_saved_pcts')
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [
    check('assistant_threads_title_check', sql`char_length(${t.title}) <= 120`),
    check('assistant_threads_origin_check', sql`${t.origin} in ('chat','schedule','review')`),
    index('assistant_threads_owner_idx').on(
      t.accountId,
      t.ownerUserId,
      t.archived,
      t.lastMessageAt.desc(),
    ),
    ...accountPolicies('assistant_threads'),
  ],
);

export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: uuid('id').primaryKey(),
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id').notNull(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => assistantThreads.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull().default(''),
    toolCalls: jsonb('tool_calls'),
    toolCallId: text('tool_call_id'),
    toolName: text('tool_name'),
    pageContext: jsonb('page_context'),
    uiActions: jsonb('ui_actions').notNull().default([]),
    runId: uuid('run_id'),
    active: boolean('active').notNull().default(true),
    compacted: boolean('compacted').notNull().default(false),
    isSummary: boolean('is_summary').notNull().default(false),
    /**
     * Order of the active history: `seq` for ordinary rows; a compaction summary sorts just
     * before the rows it summarised (their lowest sort_seq − 0.5, or the folded summary's own), so
     * it stays between the head and the kept tail. A trigger fills it from `seq` when an insert
     * omits it.
     */
    sortSeq: numeric('sort_seq', { mode: 'number' }).notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('assistant_messages_seq_unique').on(t.threadId, t.seq),
    index('assistant_messages_sort_idx').on(t.threadId, t.sortSeq),
    check('assistant_messages_role_check', sql`${t.role} in ('user','assistant','tool','event')`),
    ...accountPolicies('assistant_messages'),
  ],
);

export const assistantRuns = pgTable(
  'assistant_runs',
  {
    /** = client turn id, so a retried turn is idempotent. */
    id: uuid('id').primaryKey(),
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id').notNull(),
    threadId: uuid('thread_id').references(() => assistantThreads.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    tier: text('tier').notNull(),
    provider: text('provider'),
    model: text('model'),
    promptVersion: text('prompt_version').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    rounds: integer('rounds').notNull().default(0),
    outcome: text('outcome'),
    guardrail: text('guardrail'),
    createdAt: ts('created_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    check(
      'assistant_runs_kind_check',
      sql`${t.kind} in ('chat','review','compaction','schedule','curator','title')`,
    ),
    check('assistant_runs_status_check', sql`${t.status} in ('running','done','failed')`),
    index('assistant_runs_owner_idx').on(t.accountId, t.ownerUserId, t.createdAt.desc()),
    index('assistant_runs_running_idx')
      .on(t.ownerUserId)
      .where(sql`status = 'running'`),
    ...accountPolicies('assistant_runs'),
  ],
);

export const assistantRunSteps = pgTable(
  'assistant_run_steps',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => assistantRuns.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    accountId: accountRef(),
    kind: text('kind').notNull(),
    toolName: text('tool_name'),
    ok: boolean('ok'),
    ms: integer('ms'),
    errorCode: text('error_code'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.idx] }), ...accountPolicies('assistant_run_steps')],
);

export const assistantMemory = pgTable(
  'assistant_memory',
  {
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    /** `owner_profile`, `notes` or `business:<uuid>`. */
    store: text('store').notNull(),
    /** Ordered `{ id, text, origin, createdAt }[]`. */
    entries: jsonb('entries').notNull().default([]),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.ownerUserId, t.store] }),
    check(
      'assistant_memory_store_check',
      sql`${t.store} ~ '^(owner_profile|notes|business:[0-9a-f-]{36})$'`,
    ),
    ...accountPolicies('assistant_memory'),
  ],
);

export const assistantProposals = pgTable(
  'assistant_proposals',
  {
    id: uuid('id').primaryKey(),
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id').notNull(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => assistantThreads.id, { onDelete: 'cascade' }),
    runId: uuid('run_id'),
    businessId: uuid('business_id')
      .notNull()
      .references(() => workspaces.id),
    /** `METHOD /path` of the route contract, e.g. `PATCH /products/{productId}`. */
    routeKey: text('route_key').notNull(),
    /** Concrete path with the params filled in, relative to `/api/v1`. */
    path: text('path').notNull(),
    query: jsonb('query'),
    body: jsonb('body'),
    summary: text('summary').notNull(),
    preview: jsonb('preview'),
    status: text('status').notNull().default('pending'),
    errorCode: text('error_code'),
    resultPreview: text('result_preview'),
    expiresAt: ts('expires_at').notNull(),
    decidedAt: ts('decided_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('assistant_proposals_summary_check', sql`char_length(${t.summary}) <= 300`),
    check(
      'assistant_proposals_status_check',
      sql`${t.status} in ('pending','executing','done','failed','rejected','expired')`,
    ),
    index('assistant_proposals_thread_idx').on(t.accountId, t.ownerUserId, t.threadId, t.createdAt),
    ...accountPolicies('assistant_proposals'),
  ],
);
