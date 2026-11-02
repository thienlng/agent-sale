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
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { accounts } from './account.js';
import { users } from './identity.js';
import { accountPolicies, workspaces } from './workspace.js';

/*
 * Owner assistant (0056, 0057, 0058 and 0061, ADR-023). ACCOUNT-scoped, not workspace-scoped: every row carries
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
    /** Owner turns since the last review (review trigger counter, 0058). */
    reviewOwnerTurns: integer('review_owner_turns').notNull().default(0),
    /** Tool-loop rounds since the last review (review trigger counter, 0058). */
    reviewToolRounds: integer('review_tool_rounds').notNull().default(0),
    lastReviewAt: ts('last_review_at'),
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
    /** 👍 (1) or 👎 (-1) of the owner on an assistant answer; NULL = none (0058). */
    feedback: smallint('feedback'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('assistant_messages_seq_unique').on(t.threadId, t.seq),
    index('assistant_messages_sort_idx').on(t.threadId, t.sortSeq),
    check('assistant_messages_role_check', sql`${t.role} in ('user','assistant','tool','event')`),
    check('assistant_messages_feedback_check', sql`${t.feedback} in (-1, 1)`),
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
      sql`${t.kind} in ('chat','compaction','curator','import_vision','review','schedule','title')`,
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

/**
 * An owner's product import (0061, T-173): the sheet rows or photo drafts, the model's mapping
 * spec, the computed drafts and the per-draft results. Purged lazily after 30 days.
 */
export const assistantImportBatches = pgTable(
  'assistant_import_batches',
  {
    id: uuid('id').primaryKey(),
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id').notNull(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => assistantThreads.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
      .notNull()
      .references(() => workspaces.id),
    kind: text('kind').notNull(),
    fileName: text('file_name').notNull(),
    status: text('status').notNull().default('ready'),
    /** Sheet `{kind, rows}` or photos `{kind, grouping, groups}`; never sent to the web. */
    source: jsonb('source').notNull(),
    spec: jsonb('spec'),
    overrides: jsonb('overrides').notNull().default({}),
    excluded: jsonb('excluded').notNull().default([]),
    drafts: jsonb('drafts'),
    draftsHash: text('drafts_hash'),
    /** `{[draftKey]: ImportRowResult}`. */
    results: jsonb('results').notNull().default({}),
    rowCount: integer('row_count').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('assistant_import_batches_kind_check', sql`${t.kind} in ('sheet','photos')`),
    check('assistant_import_batches_status_check', sql`${t.status} in ('drafting','ready')`),
    check('assistant_import_batches_file_name_check', sql`char_length(${t.fileName}) <= 200`),
    check('assistant_import_batches_source_check', sql`octet_length(${t.source}::text) <= 2000000`),
    check('assistant_import_batches_row_count_check', sql`${t.rowCount} >= 0`),
    index('assistant_import_batches_thread_idx').on(
      t.accountId,
      t.ownerUserId,
      t.threadId,
      t.createdAt,
    ),
    ...accountPolicies('assistant_import_batches'),
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
    /** `route` (1b), `schedule` (capability 3) or `product_import` (0061). */
    kind: text('kind').notNull().default('route'),
    /** The batch a `product_import` proposal imports; its data lives there, not in `body`. */
    importBatchId: uuid('import_batch_id').references(() => assistantImportBatches.id, {
      onDelete: 'cascade',
    }),
  },
  (t) => [
    check('assistant_proposals_summary_check', sql`char_length(${t.summary}) <= 300`),
    check(
      'assistant_proposals_kind_check',
      sql`${t.kind} in ('route','schedule','product_import')`,
    ),
    check(
      'assistant_proposals_import_batch_check',
      sql`(${t.kind} = 'product_import') = (${t.importBatchId} is not null)`,
    ),
    index('assistant_proposals_import_batch_idx')
      .on(t.importBatchId)
      .where(sql`import_batch_id is not null`),
    check(
      'assistant_proposals_status_check',
      sql`${t.status} in ('pending','executing','done','failed','rejected','expired')`,
    ),
    index('assistant_proposals_thread_idx').on(t.accountId, t.ownerUserId, t.threadId, t.createdAt),
    ...accountPolicies('assistant_proposals'),
  ],
);

/** Owner, learned and shadow skills (0058); platform skills are files, never rows. */
export const assistantSkills = pgTable(
  'assistant_skills',
  {
    id: uuid('id').primaryKey(),
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    description: text('description').notNull(),
    body: text('body').notNull(),
    toolsets: text('toolsets')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** `owner` | `learned` | `shadow`. */
    provenance: text('provenance').notNull(),
    /** The platform skill a `shadow` row replaces; NULL otherwise. */
    shadowOf: text('shadow_of'),
    state: text('state').notNull().default('active'),
    pinned: boolean('pinned').notNull().default(false),
    useCount: integer('use_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    patchCount: integer('patch_count').notNull().default(0),
    lastUsedAt: ts('last_used_at'),
    lastPatchedAt: ts('last_patched_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    /** Optimistic-concurrency token, kept at millisecond precision so a JS Date matches it. */
    updatedAt: ts('updated_at')
      .notNull()
      .default(sql`date_trunc('milliseconds', now())`),
  },
  (t) => [
    check(
      'assistant_skills_name_check',
      sql`${t.name} ~ '^[a-z0-9][a-z0-9-]*$' and char_length(${t.name}) <= 64`,
    ),
    check('assistant_skills_description_check', sql`char_length(${t.description}) <= 120`),
    check('assistant_skills_body_check', sql`char_length(${t.body}) <= 8000`),
    check(
      'assistant_skills_provenance_check',
      sql`${t.provenance} in ('owner','learned','shadow')`,
    ),
    check(
      'assistant_skills_state_check',
      sql`${t.state} in ('pending_approval','active','stale','archived')`,
    ),
    check(
      'assistant_skills_shadow_check',
      sql`(${t.provenance} = 'shadow') = (${t.shadowOf} is not null)`,
    ),
    uniqueIndex('assistant_skills_name_unique')
      .on(t.accountId, t.ownerUserId, t.name)
      .where(sql`state <> 'archived'`),
    ...accountPolicies('assistant_skills'),
  ],
);

/** Append-only ledger of skill changes (0058): `before`/`after` snapshot name, description, body, state. */
export const assistantSkillEvents = pgTable(
  'assistant_skill_events',
  {
    id: uuid('id').primaryKey(),
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id').notNull(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => assistantSkills.id, { onDelete: 'cascade' }),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    runId: uuid('run_id'),
    undoneAt: ts('undone_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'assistant_skill_events_actor_check',
      sql`${t.actor} in ('owner','assistant','review','curator')`,
    ),
    check(
      'assistant_skill_events_action_check',
      sql`${t.action} in ('create','patch','archive','restore','approve','reject','undo')`,
    ),
    index('assistant_skill_events_owner_idx').on(t.accountId, t.ownerUserId, t.createdAt),
    index('assistant_skill_events_skill_idx').on(t.skillId, t.createdAt),
    ...accountPolicies('assistant_skill_events'),
  ],
);

/** Proactive suggestion cards (0058); `dedup_key` stays taken in every status. */
export const assistantSuggestions = pgTable(
  'assistant_suggestions',
  {
    id: uuid('id').primaryKey(),
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    dedupKey: text('dedup_key').notNull(),
    title: text('title').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull().default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
    decidedAt: ts('decided_at'),
  },
  (t) => [
    check('assistant_suggestions_kind_check', sql`${t.kind} in ('schedule','skill','setup')`),
    check('assistant_suggestions_dedup_key_check', sql`char_length(${t.dedupKey}) <= 120`),
    check('assistant_suggestions_title_check', sql`char_length(${t.title}) <= 200`),
    check(
      'assistant_suggestions_status_check',
      sql`${t.status} in ('pending','accepted','dismissed')`,
    ),
    unique('assistant_suggestions_dedup_unique').on(t.accountId, t.ownerUserId, t.dedupKey),
    ...accountPolicies('assistant_suggestions'),
  ],
);

/** Per-owner assistant settings (0058); no row = the defaults. */
export const assistantSettings = pgTable(
  'assistant_settings',
  {
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    reviewEnabled: boolean('review_enabled').notNull().default(true),
    disabledToolsets: text('disabled_toolsets')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** When the curator last scanned this owner's learned skills. */
    curatorRanAt: ts('curator_ran_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.ownerUserId] }),
    ...accountPolicies('assistant_settings'),
  ],
);

/**
 * Postgres-leased background jobs of the worker (0058): the review after a conversation and the
 * daily curator. The SQL index `assistant_jobs_queued_unique` is `NULLS NOT DISTINCT`, so a
 * curator job (no thread) is also unique per owner while queued.
 */
export const assistantJobs = pgTable(
  'assistant_jobs',
  {
    id: uuid('id').primaryKey(),
    accountId: accountRef(),
    ownerUserId: uuid('owner_user_id').notNull(),
    threadId: uuid('thread_id').references(() => assistantThreads.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    reviewScope: text('review_scope'),
    status: text('status').notNull().default('queued'),
    runAfter: ts('run_after').notNull().defaultNow(),
    leaseUntil: ts('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    errorCode: text('error_code'),
    createdAt: ts('created_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    check('assistant_jobs_kind_check', sql`${t.kind} in ('review','curator')`),
    check(
      'assistant_jobs_review_scope_check',
      sql`${t.reviewScope} in ('memory','skills','combined')`,
    ),
    check(
      'assistant_jobs_status_check',
      sql`${t.status} in ('queued','running','done','failed','cancelled')`,
    ),
    check(
      'assistant_jobs_scope_check',
      sql`(${t.kind} = 'review') = (${t.reviewScope} is not null)`,
    ),
    index('assistant_jobs_status_idx').on(t.status, t.runAfter),
    uniqueIndex('assistant_jobs_queued_unique')
      .on(t.accountId, t.ownerUserId, t.kind, t.threadId)
      .where(sql`status = 'queued'`),
    ...accountPolicies('assistant_jobs'),
  ],
);
