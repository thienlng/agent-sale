import { PRUNED_TOOL_TEXT } from '@agent-sales/ai-core';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  schema,
  sql,
  withAccount,
  withSystem,
  type Database,
  type TenantTx,
} from '@agent-sales/db';

import {
  AssistantNotFoundError,
  AssistantRunIdTakenError,
  AssistantSkillNameTakenError,
} from '../../domain/assistant.errors.js';
import type { OwnerScope } from '../../domain/owner-scope.js';
import {
  type AssistantRepository,
  type AssistantSettingsRecord,
  type CompactionInput,
  DEFAULT_ASSISTANT_SETTINGS,
  JOB_MAX_ATTEMPTS,
  type JobKind,
  type JobRecord,
  type MessageFeedback,
  type NewJob,
  type NewSkill,
  type NewSkillEvent,
  type NewSuggestion,
  type OwnerKey,
  type ReviewCounters,
  type SettingsPatch,
  SKILL_EVENT_LIST_LIMIT,
  type SkillEventInput,
  type SkillEventQuery,
  type SkillEventRecord,
  type SkillPatch,
  type SkillProvenance,
  type SkillRecord,
  type SkillSnapshot,
  type SkillState,
  skillSnapshot,
  type SuggestionRecord,
  type SuggestionStatus,
  type MemoryEntry,
  type MemoryStoreRecord,
  type MemoryTombstone,
  type MessageRecord,
  type NewMessage,
  type NewProposal,
  type ProposalPatch,
  type ProposalRecord,
  type ProposalStatus,
  type RecordedRun,
  type RunRecord,
  RUN_BUSY_WINDOW_MS,
  type SearchHit,
  type StepRecord,
  summarySortSeq,
  THREAD_LIST_LIMIT,
  type ThreadOrigin,
  type ThreadRecord,
} from '../../domain/ports/assistant.repository.js';
import { snippetAround } from '../../domain/search-text.js';

const t = schema.assistantThreads;
const m = schema.assistantMessages;
const r = schema.assistantRuns;
const st = schema.assistantRunSteps;
const mem = schema.assistantMemory;
const pr = schema.assistantProposals;
const sk = schema.assistantSkills;
const se = schema.assistantSkillEvents;
const sg = schema.assistantSuggestions;
const set_ = schema.assistantSettings;
const jb = schema.assistantJobs;

/** SQLSTATE of a driver error (drizzle wraps the postgres error in `cause`). */
const pgCode = (e: unknown): string | undefined =>
  (e as { cause?: { code?: string } } | null)?.cause?.code ?? (e as { code?: string } | null)?.code;

/** `%text%` for ILIKE, with the wildcards the owner typed taken literally. */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const ownsThread = (s: OwnerKey) =>
  and(eq(t.accountId, s.accountId), eq(t.ownerUserId, s.ownerUserId));
const ownsMessage = (s: OwnerKey) =>
  and(eq(m.accountId, s.accountId), eq(m.ownerUserId, s.ownerUserId));
const ownsRun = (s: OwnerScope) =>
  and(eq(r.accountId, s.accountId), eq(r.ownerUserId, s.ownerUserId));
const ownsMemory = (s: OwnerScope) =>
  and(eq(mem.accountId, s.accountId), eq(mem.ownerUserId, s.ownerUserId));
const ownsProposal = (s: OwnerScope) =>
  and(eq(pr.accountId, s.accountId), eq(pr.ownerUserId, s.ownerUserId));
const ownsSkill = (s: OwnerKey) =>
  and(eq(sk.accountId, s.accountId), eq(sk.ownerUserId, s.ownerUserId));
const ownsSkillEvent = (s: OwnerKey) =>
  and(eq(se.accountId, s.accountId), eq(se.ownerUserId, s.ownerUserId));
const ownsSuggestion = (s: OwnerKey) =>
  and(eq(sg.accountId, s.accountId), eq(sg.ownerUserId, s.ownerUserId));
const ownsSettings = (s: OwnerKey) =>
  and(eq(set_.accountId, s.accountId), eq(set_.ownerUserId, s.ownerUserId));
const ownsJob = (s: OwnerKey) =>
  and(eq(jb.accountId, s.accountId), eq(jb.ownerUserId, s.ownerUserId));

/** Strictly increasing, millisecond-precise `updated_at`: the optimistic-lock token round-trips. */
const nextSkillVersion = sql`greatest(date_trunc('milliseconds', now()), ${sk.updatedAt} + interval '1 millisecond')`;

/** A unique violation of the non-archived skill name index. */
function skillNameTaken(e: unknown): boolean {
  const err = e as { code?: string; constraint_name?: string; cause?: unknown } | null;
  const cause = (err?.cause ?? err) as { code?: string; constraint_name?: string } | null;
  return cause?.code === '23505' && cause.constraint_name === 'assistant_skills_name_unique';
}

function toThread(row: typeof t.$inferSelect): ThreadRecord {
  return {
    id: row.id,
    title: row.title,
    origin: row.origin as ThreadOrigin,
    pinned: row.pinned,
    archived: row.archived,
    businessId: row.businessId,
    systemPrompt: row.systemPrompt,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt,
    cacheRootId: row.cacheRootId,
    compactedAt: row.compactedAt,
    compactionFailedAt: row.compactionFailedAt,
    compactionSavedPcts: row.compactionSavedPcts,
    reviewOwnerTurns: row.reviewOwnerTurns,
    reviewToolRounds: row.reviewToolRounds,
    lastReviewAt: row.lastReviewAt,
  };
}

function toMessage(row: typeof m.$inferSelect): MessageRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    seq: row.seq,
    role: row.role as MessageRecord['role'],
    content: row.content,
    toolCalls: (row.toolCalls as unknown[] | null) ?? null,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    pageContext: row.pageContext ?? null,
    uiActions: (row.uiActions as unknown[] | null) ?? [],
    runId: row.runId,
    isSummary: row.isSummary,
    feedback: (row.feedback as MessageFeedback | null) ?? null,
    createdAt: row.createdAt,
  };
}

function toSkill(row: typeof sk.$inferSelect): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    toolsets: row.toolsets,
    provenance: row.provenance as SkillProvenance,
    shadowOf: row.shadowOf,
    state: row.state as SkillState,
    pinned: row.pinned,
    useCount: row.useCount,
    viewCount: row.viewCount,
    patchCount: row.patchCount,
    lastUsedAt: row.lastUsedAt,
    lastPatchedAt: row.lastPatchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSkillEvent(row: typeof se.$inferSelect): SkillEventRecord {
  return {
    id: row.id,
    skillId: row.skillId,
    actor: row.actor as SkillEventRecord['actor'],
    action: row.action as SkillEventRecord['action'],
    before: (row.before as SkillSnapshot | null) ?? null,
    after: (row.after as SkillSnapshot | null) ?? null,
    runId: row.runId,
    undoneAt: row.undoneAt,
    createdAt: row.createdAt,
  };
}

function toSuggestion(row: typeof sg.$inferSelect): SuggestionRecord {
  return {
    id: row.id,
    kind: row.kind as SuggestionRecord['kind'],
    dedupKey: row.dedupKey,
    title: row.title,
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    status: row.status as SuggestionStatus,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

function toSettings(row: typeof set_.$inferSelect): AssistantSettingsRecord {
  return {
    reviewEnabled: row.reviewEnabled,
    disabledToolsets: row.disabledToolsets,
    curatorRanAt: row.curatorRanAt,
    updatedAt: row.updatedAt,
  };
}

function toJob(row: typeof jb.$inferSelect): JobRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    ownerUserId: row.ownerUserId,
    threadId: row.threadId,
    kind: row.kind as JobKind,
    reviewScope: row.reviewScope as JobRecord['reviewScope'],
    status: row.status as JobRecord['status'],
    runAfter: row.runAfter,
    leaseUntil: row.leaseUntil,
    attempts: row.attempts,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

/** A raw `assistant_jobs` row (snake_case) from `tx.execute`. */
type RawJob = {
  id: string;
  account_id: string;
  owner_user_id: string;
  thread_id: string | null;
  kind: string;
  review_scope: string | null;
  status: string;
  run_after: string | Date;
  lease_until: string | Date | null;
  attempts: number;
  error_code: string | null;
  created_at: string | Date;
  finished_at: string | Date | null;
};

const dateOrNull = (v: string | Date | null) => (v === null ? null : new Date(v));

function rawJob(row: RawJob): JobRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    ownerUserId: row.owner_user_id,
    threadId: row.thread_id,
    kind: row.kind as JobKind,
    reviewScope: row.review_scope as JobRecord['reviewScope'],
    status: row.status as JobRecord['status'],
    runAfter: new Date(row.run_after),
    leaseUntil: dateOrNull(row.lease_until),
    attempts: Number(row.attempts),
    errorCode: row.error_code,
    createdAt: new Date(row.created_at),
    finishedAt: dateOrNull(row.finished_at),
  };
}

/**
 * Tombstones (owner-deleted texts, QA NB-4) share the store's `entries` jsonb as items marked
 * `tombstone: true`, so no column is needed; only this mapper and `saveMemoryStore` see them.
 */
type StoredMemoryItem = MemoryEntry | (MemoryTombstone & { tombstone: true });

const isTombstoneItem = (x: StoredMemoryItem): x is MemoryTombstone & { tombstone: true } =>
  (x as { tombstone?: unknown }).tombstone === true;

function toMemory(row: typeof mem.$inferSelect): MemoryStoreRecord {
  const items = (row.entries as StoredMemoryItem[] | null) ?? [];
  const tombstones = items
    .filter(isTombstoneItem)
    .map(({ norm, deletedAt }) => ({ norm, deletedAt }));
  return {
    store: row.store,
    entries: items.filter((x): x is MemoryEntry => !isTombstoneItem(x)),
    ...(tombstones.length > 0 ? { tombstones } : {}),
    updatedAt: row.updatedAt,
  };
}

function toProposal(row: typeof pr.$inferSelect): ProposalRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    runId: row.runId,
    businessId: row.businessId,
    routeKey: row.routeKey,
    path: row.path,
    query: row.query ?? null,
    body: row.body ?? null,
    summary: row.summary,
    preview: row.preview ?? null,
    status: row.status as ProposalStatus,
    errorCode: row.errorCode,
    resultPreview: row.resultPreview,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

function toRun(row: typeof r.$inferSelect): RunRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    kind: row.kind as RunRecord['kind'],
    status: row.status as RunRecord['status'],
    tier: row.tier,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    inputTokens: row.inputTokens,
    cachedTokens: row.cachedTokens,
    outputTokens: row.outputTokens,
    latencyMs: row.latencyMs,
    rounds: row.rounds,
    outcome: row.outcome,
    guardrail: row.guardrail,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

/**
 * Assistant storage on PostgreSQL (ADR-023): every call runs in one `withAccount` transaction
 * (RLS on `account_id`) and filters by account AND owner explicitly, so a second owner of the
 * same account sees nothing of the first. Thread/run ownership is checked in the same
 * transaction before any read or write by id.
 */
export class DrizzleAssistantRepository implements AssistantRepository {
  /**
   * @param db tenant connection (`app_tenant`): every owner call, under `withAccount`.
   * @param system cross-account connection (`app_system`), only for the worker's `claimJobs`
   *   and `ownersWithLearnedSkills`; null where the process has none (they then throw).
   */
  constructor(
    private readonly db: Database,
    private readonly system: Database | null = null,
  ) {}

  #in<T>(s: OwnerKey, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return withAccount(this.db, s.accountId, fn);
  }

  #sys<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!this.system) {
      return Promise.reject(new Error('assistant worker calls need the system connection'));
    }
    return withSystem(this.system, fn);
  }

  /** The owner's thread row, locked for update when asked; NOT_FOUND otherwise. */
  async #ownThread(tx: TenantTx, s: OwnerKey, threadId: string, lock = false) {
    const query = tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.id, threadId), ownsThread(s)));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw new AssistantNotFoundError('thread', threadId);
  }

  async #ownRun(tx: TenantTx, s: OwnerScope, runId: string) {
    const [row] = await tx
      .select({ id: r.id })
      .from(r)
      .where(and(eq(r.id, runId), ownsRun(s)));
    if (!row) throw new AssistantNotFoundError('run', runId);
  }

  listThreads(s: OwnerScope, q: { archived: boolean; text?: string }): Promise<ThreadRecord[]> {
    return this.#in(s, async (tx) => {
      const text = q.text?.trim();
      const pattern = text ? containsPattern(text) : '';
      const matches = text
        ? or(
            sql`assistant_unaccent(${t.title}) ilike assistant_unaccent(${pattern})`,
            sql`exists (
              select 1 from assistant_messages am
              where am.thread_id = ${t.id}
                and am.account_id = ${s.accountId} and am.owner_user_id = ${s.ownerUserId}
                and am.role in ('user', 'assistant') and not am.is_summary
                and (am.search @@ plainto_tsquery('simple', assistant_unaccent(${text}))
                  or assistant_unaccent(am.content) ilike assistant_unaccent(${pattern})))`,
          )
        : undefined;
      const rows = await tx
        .select()
        .from(t)
        .where(and(ownsThread(s), eq(t.archived, q.archived), matches))
        .orderBy(desc(t.pinned), desc(t.lastMessageAt))
        .limit(THREAD_LIST_LIMIT);
      return rows.map(toThread);
    });
  }

  getThread(s: OwnerKey, threadId: string): Promise<ThreadRecord | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .select()
        .from(t)
        .where(and(eq(t.id, threadId), ownsThread(s)));
      return row ? toThread(row) : null;
    });
  }

  createThread(
    s: OwnerScope,
    input: { id: string; title: string; systemPrompt: string; promptVersion: string },
  ): Promise<ThreadRecord> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .insert(t)
        .values({
          ...input,
          accountId: s.accountId,
          ownerUserId: s.ownerUserId,
          businessId: s.businessId,
        })
        .returning();
      if (!row) throw new Error('assistant thread insert returned no row');
      return toThread(row);
    });
  }

  updateThread(
    s: OwnerScope,
    threadId: string,
    patch: Partial<Pick<ThreadRecord, 'title' | 'pinned' | 'archived'>>,
  ): Promise<ThreadRecord | null> {
    return this.#in(s, async (tx) => {
      const set: Partial<typeof t.$inferInsert> = {};
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.pinned !== undefined) set.pinned = patch.pinned;
      if (patch.archived !== undefined) set.archived = patch.archived;
      if (Object.keys(set).length === 0) {
        const [row] = await tx
          .select()
          .from(t)
          .where(and(eq(t.id, threadId), ownsThread(s)));
        return row ? toThread(row) : null;
      }
      const [row] = await tx
        .update(t)
        .set(set)
        .where(and(eq(t.id, threadId), ownsThread(s)))
        .returning();
      return row ? toThread(row) : null;
    });
  }

  listMessages(
    s: OwnerScope,
    threadId: string,
    opts?: { activeOnly?: boolean },
  ): Promise<MessageRecord[]> {
    return this.#in(s, async (tx) => {
      await this.#ownThread(tx, s, threadId);
      const rows = await tx
        .select()
        .from(m)
        .where(
          and(
            eq(m.threadId, threadId),
            ownsMessage(s),
            opts?.activeOnly ? eq(m.active, true) : undefined,
          ),
        )
        .orderBy(...(opts?.activeOnly ? [asc(m.sortSeq), asc(m.seq)] : [asc(m.seq)]));
      return rows.map(toMessage);
    });
  }

  appendMessages(s: OwnerScope, threadId: string, msgs: NewMessage[]): Promise<MessageRecord[]> {
    return this.#in(s, async (tx) => {
      // The row lock serialises appends to one thread, so seq numbers never collide.
      await this.#ownThread(tx, s, threadId, true);
      if (msgs.length === 0) return [];
      const [{ last } = { last: 0 }] = await tx
        .select({ last: sql<number>`coalesce(max(${m.seq}), 0)::int` })
        .from(m)
        .where(eq(m.threadId, threadId));
      const rows = await tx
        .insert(m)
        .values(
          msgs.map((msg, i) => ({
            id: msg.id,
            accountId: s.accountId,
            ownerUserId: s.ownerUserId,
            threadId,
            seq: last + i + 1,
            sortSeq: last + i + 1,
            role: msg.role,
            content: msg.content,
            toolCalls: msg.toolCalls,
            toolCallId: msg.toolCallId,
            toolName: msg.toolName,
            pageContext: msg.pageContext,
            uiActions: msg.uiActions,
            runId: msg.runId,
          })),
        )
        .returning();
      await tx
        .update(t)
        .set({ lastMessageAt: sql`now()` })
        .where(and(eq(t.id, threadId), ownsThread(s)));
      return rows.map(toMessage).sort((a, b) => a.seq - b.seq);
    });
  }

  searchMessages(s: OwnerScope, query: string, limit: number): Promise<SearchHit[]> {
    const text = query.trim();
    if (!text) return Promise.resolve([]);
    const pattern = containsPattern(text);
    return this.#in(s, async (tx) => {
      const rows = await tx.execute<{
        id: string;
        thread_id: string;
        title: string;
        seq: number;
        role: string;
        content: string;
        created_at: string | Date;
      }>(sql`
        select am.id, am.thread_id, at.title, am.seq, am.role, am.content, am.created_at
        from assistant_messages am
        join assistant_threads at on at.id = am.thread_id
        where am.account_id = ${s.accountId} and am.owner_user_id = ${s.ownerUserId}
          and at.account_id = ${s.accountId} and at.owner_user_id = ${s.ownerUserId}
          and am.role in ('user', 'assistant') and not am.is_summary
          and (am.search @@ plainto_tsquery('simple', assistant_unaccent(${text}))
            or assistant_unaccent(am.content) ilike assistant_unaccent(${pattern}))
        order by (at.origin in ('schedule', 'review')),
          ts_rank(am.search, plainto_tsquery('simple', assistant_unaccent(${text}))) desc,
          am.created_at desc
        limit ${limit}`);
      return [...rows].map((row) => ({
        threadId: row.thread_id,
        threadTitle: row.title,
        messageId: row.id,
        seq: Number(row.seq),
        role: row.role,
        snippet: snippetAround(row.content, text),
        createdAt: new Date(row.created_at),
      }));
    });
  }

  startRun(
    s: OwnerScope,
    run: { id: string; threadId: string; tier: string; promptVersion: string },
  ): Promise<'started' | 'busy' | 'duplicate'> {
    return this.#in(s, async (tx) => {
      await this.#ownThread(tx, s, run.threadId);
      // One owner starts runs one at a time, so two sends cannot both pass the busy check.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`assistant:${s.ownerUserId}`}))`,
      );
      const [existing] = await tx
        .select({ ownerUserId: r.ownerUserId })
        .from(r)
        .where(eq(r.id, run.id));
      if (existing) {
        if (existing.ownerUserId === s.ownerUserId) return 'duplicate';
        throw new AssistantRunIdTakenError();
      }
      const [busy] = await tx
        .select({ id: r.id })
        .from(r)
        .where(
          and(
            ownsRun(s),
            eq(r.status, 'running'),
            sql`${r.createdAt} > now() - make_interval(secs => ${RUN_BUSY_WINDOW_MS / 1000})`,
          ),
        )
        .limit(1);
      if (busy) return 'busy';
      await tx.insert(r).values({
        id: run.id,
        accountId: s.accountId,
        ownerUserId: s.ownerUserId,
        threadId: run.threadId,
        kind: 'chat',
        status: 'running',
        tier: run.tier,
        promptVersion: run.promptVersion,
      });
      return 'started';
    }).catch((e: unknown) => {
      // The id is a run of another account, invisible under RLS: the primary key still collides.
      if (pgCode(e) === '23505') throw new AssistantRunIdTakenError();
      throw e;
    });
  }

  addStep(s: OwnerScope, step: StepRecord): Promise<void> {
    return this.#in(s, async (tx) => {
      await this.#ownRun(tx, s, step.runId);
      await tx.insert(st).values({ ...step, accountId: s.accountId });
    });
  }

  finishRun(s: OwnerScope, runId: string, patch: Partial<RunRecord>): Promise<void> {
    return this.#in(s, async (tx) => {
      const { id: _i, threadId: _t, kind: _k, createdAt: _c, ...allowed } = patch;
      const set = Object.fromEntries(
        Object.entries(allowed).filter(([, v]) => v !== undefined),
      ) as Partial<typeof r.$inferInsert>;
      if (Object.keys(set).length === 0) return this.#ownRun(tx, s, runId);
      const rows = await tx
        .update(r)
        .set(set)
        .where(and(eq(r.id, runId), ownsRun(s)))
        .returning({ id: r.id });
      if (rows.length === 0) throw new AssistantNotFoundError('run', runId);
    });
  }

  getRun(s: OwnerScope, runId: string): Promise<(RunRecord & { steps: StepRecord[] }) | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .select()
        .from(r)
        .where(and(eq(r.id, runId), ownsRun(s)));
      if (!row) return null;
      const steps = await tx
        .select({
          runId: st.runId,
          idx: st.idx,
          kind: st.kind,
          toolName: st.toolName,
          ok: st.ok,
          ms: st.ms,
          errorCode: st.errorCode,
        })
        .from(st)
        .where(and(eq(st.runId, runId), eq(st.accountId, s.accountId)))
        .orderBy(asc(st.idx));
      return { ...toRun(row), steps };
    });
  }

  getLastChatRun(s: OwnerScope, threadId: string): Promise<RunRecord | null> {
    return this.#in(s, async (tx) => {
      await this.#ownThread(tx, s, threadId);
      const [row] = await tx
        .select()
        .from(r)
        .where(and(ownsRun(s), eq(r.threadId, threadId), eq(r.kind, 'chat'), eq(r.status, 'done')))
        .orderBy(desc(r.createdAt))
        .limit(1);
      return row ? toRun(row) : null;
    });
  }

  recordRun(s: OwnerScope, run: RecordedRun): Promise<void> {
    return this.#in(s, async (tx) => {
      if (run.threadId) await this.#ownThread(tx, s, run.threadId);
      await tx.insert(r).values({
        ...run,
        accountId: s.accountId,
        ownerUserId: s.ownerUserId,
        finishedAt: sql`now()`,
      });
    }).catch((e: unknown) => {
      if (pgCode(e) === '23505') throw new AssistantRunIdTakenError();
      throw e;
    });
  }

  // ─── Memory ───

  getMemory(s: OwnerScope): Promise<MemoryStoreRecord[]> {
    return this.#in(s, async (tx) => {
      const rows = await tx.select().from(mem).where(ownsMemory(s)).orderBy(asc(mem.store));
      return rows.map(toMemory);
    });
  }

  saveMemoryStore(
    s: OwnerScope,
    store: string,
    entries: MemoryEntry[],
    tombstones?: MemoryTombstone[],
  ): Promise<MemoryStoreRecord> {
    return this.#in(s, async (tx) => {
      let kept = tombstones;
      if (kept === undefined) {
        const [old] = await tx
          .select()
          .from(mem)
          .where(and(ownsMemory(s), eq(mem.store, store)))
          .for('update');
        kept = old ? (toMemory(old).tombstones ?? []) : [];
      }
      const items: StoredMemoryItem[] = [
        ...entries,
        ...kept.map((t) => ({ tombstone: true as const, norm: t.norm, deletedAt: t.deletedAt })),
      ];
      const [row] = await tx
        .insert(mem)
        .values({ accountId: s.accountId, ownerUserId: s.ownerUserId, store, entries: items })
        .onConflictDoUpdate({
          target: [mem.accountId, mem.ownerUserId, mem.store],
          set: { entries: items, updatedAt: sql`now()` },
        })
        .returning();
      if (!row) throw new Error('assistant memory upsert returned no row');
      return toMemory(row);
    });
  }

  // ─── Proposals ───

  createProposal(s: OwnerScope, p: NewProposal): Promise<ProposalRecord> {
    return this.#in(s, async (tx) => {
      await this.#ownThread(tx, s, p.threadId);
      const [row] = await tx
        .insert(pr)
        .values({ ...p, accountId: s.accountId, ownerUserId: s.ownerUserId, status: 'pending' })
        .returning();
      if (!row) throw new Error('assistant proposal insert returned no row');
      return toProposal(row);
    });
  }

  listProposals(s: OwnerScope, threadId: string): Promise<ProposalRecord[]> {
    return this.#in(s, async (tx) => {
      await this.#ownThread(tx, s, threadId);
      const rows = await tx
        .select()
        .from(pr)
        .where(and(eq(pr.threadId, threadId), ownsProposal(s)))
        .orderBy(asc(pr.createdAt), asc(pr.id));
      return rows.map(toProposal);
    });
  }

  getProposal(s: OwnerScope, id: string): Promise<ProposalRecord | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .select()
        .from(pr)
        .where(and(eq(pr.id, id), ownsProposal(s)));
      return row ? toProposal(row) : null;
    });
  }

  transitionProposal(
    s: OwnerScope,
    id: string,
    from: ProposalStatus[],
    to: ProposalStatus,
    patch: ProposalPatch = {},
  ): Promise<ProposalRecord | null> {
    if (from.length === 0) return Promise.resolve(null);
    return this.#in(s, async (tx) => {
      const set: Partial<typeof pr.$inferInsert> = { status: to };
      if (patch.errorCode !== undefined) set.errorCode = patch.errorCode;
      if (patch.resultPreview !== undefined) set.resultPreview = patch.resultPreview;
      if (patch.decidedAt !== undefined) set.decidedAt = patch.decidedAt;
      // One conditional UPDATE: a concurrent transaction blocks on the row lock, then re-checks
      // the status and changes nothing, so exactly one caller wins.
      const [row] = await tx
        .update(pr)
        .set(set)
        .where(and(eq(pr.id, id), ownsProposal(s), inArray(pr.status, from)))
        .returning();
      return row ? toProposal(row) : null;
    });
  }

  expireProposals(s: OwnerScope, now: Date): Promise<number> {
    return this.#in(s, async (tx) => {
      const rows = await tx
        .update(pr)
        .set({ status: 'expired' })
        .where(and(ownsProposal(s), eq(pr.status, 'pending'), lt(pr.expiresAt, now)))
        .returning({ id: pr.id });
      return rows.length;
    });
  }

  // ─── Compaction ───

  applyCompaction(s: OwnerScope, threadId: string, c: CompactionInput): Promise<MessageRecord> {
    if (c.deactivateIds.length === 0) {
      return Promise.reject(new Error('assistant compaction needs a middle to summarise'));
    }
    return this.#in(s, async (tx) => {
      // The thread lock serialises this with appends, so seq stays unique.
      const [thread] = await tx
        .select({ savedPcts: t.compactionSavedPcts })
        .from(t)
        .where(and(eq(t.id, threadId), ownsThread(s)))
        .for('update');
      if (!thread) throw new AssistantNotFoundError('thread', threadId);

      const middle = await tx
        .update(m)
        .set({ active: false, compacted: true })
        .where(
          and(
            eq(m.threadId, threadId),
            ownsMessage(s),
            eq(m.active, true),
            inArray(m.id, c.deactivateIds),
          ),
        )
        .returning({ sortSeq: m.sortSeq, isSummary: m.isSummary });
      // A stale plan (rows already compacted, or not in this thread) changes nothing.
      if (middle.length !== new Set(c.deactivateIds).size) {
        throw new Error('assistant compaction plan is stale');
      }
      if (c.prunedToolIds.length > 0) {
        await tx
          .update(m)
          .set({ content: PRUNED_TOOL_TEXT })
          .where(
            and(
              eq(m.threadId, threadId),
              ownsMessage(s),
              eq(m.active, true),
              eq(m.role, 'tool'),
              inArray(m.id, c.prunedToolIds),
            ),
          );
      }
      const [{ last } = { last: 0 }] = await tx
        .select({ last: sql<number>`coalesce(max(${m.seq}), 0)::int` })
        .from(m)
        .where(eq(m.threadId, threadId));
      const sortSeq = summarySortSeq(middle.map((x) => ({ ...x, sortSeq: Number(x.sortSeq) })));
      const [row] = await tx
        .insert(m)
        .values({
          id: c.summary.id,
          accountId: s.accountId,
          ownerUserId: s.ownerUserId,
          threadId,
          seq: last + 1,
          sortSeq,
          role: c.summary.role,
          content: c.summary.content,
          toolCalls: c.summary.toolCalls,
          toolCallId: c.summary.toolCallId,
          toolName: c.summary.toolName,
          pageContext: c.summary.pageContext,
          uiActions: c.summary.uiActions,
          runId: c.summary.runId,
          isSummary: true,
        })
        .returning();
      if (!row) throw new Error('assistant summary insert returned no row');
      await tx
        .update(t)
        .set({
          systemPrompt: c.systemPrompt,
          compactedAt: sql`now()`,
          compactionSavedPcts: [...thread.savedPcts, c.savedPct].slice(-2),
          cacheRootId: sql`coalesce(${t.cacheRootId}, ${t.id})`,
        })
        .where(and(eq(t.id, threadId), ownsThread(s)));
      return toMessage(row);
    });
  }

  markCompactionFailed(s: OwnerScope, threadId: string, at: Date): Promise<void> {
    return this.#in(s, async (tx) => {
      const rows = await tx
        .update(t)
        .set({ compactionFailedAt: at })
        .where(and(eq(t.id, threadId), ownsThread(s)))
        .returning({ id: t.id });
      if (rows.length === 0) throw new AssistantNotFoundError('thread', threadId);
    });
  }
  // ─── Skills ───

  listSkills(
    s: OwnerKey,
    q: { states?: SkillState[]; provenance?: SkillProvenance[] } = {},
  ): Promise<SkillRecord[]> {
    if (q.states?.length === 0 || q.provenance?.length === 0) return Promise.resolve([]);
    return this.#in(s, async (tx) => {
      const rows = await tx
        .select()
        .from(sk)
        .where(
          and(
            ownsSkill(s),
            q.states ? inArray(sk.state, q.states) : undefined,
            q.provenance ? inArray(sk.provenance, q.provenance) : undefined,
          ),
        )
        .orderBy(asc(sk.name), asc(sk.createdAt));
      return rows.map(toSkill);
    });
  }

  getSkill(s: OwnerKey, id: string): Promise<SkillRecord | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .select()
        .from(sk)
        .where(and(eq(sk.id, id), ownsSkill(s)));
      return row ? toSkill(row) : null;
    });
  }

  getSkillByName(s: OwnerKey, name: string): Promise<SkillRecord | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .select()
        .from(sk)
        .where(and(eq(sk.name, name), ownsSkill(s), sql`${sk.state} <> 'archived'`));
      return row ? toSkill(row) : null;
    });
  }

  createSkill(s: OwnerKey, skill: NewSkill, event?: SkillEventInput): Promise<SkillRecord> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .insert(sk)
        .values({ ...skill, accountId: s.accountId, ownerUserId: s.ownerUserId })
        .returning();
      if (!row) throw new Error('assistant skill insert returned no row');
      const created = toSkill(row);
      if (event) {
        await tx.insert(se).values({
          ...event,
          accountId: s.accountId,
          ownerUserId: s.ownerUserId,
          skillId: created.id,
          before: null,
          after: skillSnapshot(created),
        });
      }
      return created;
    }).catch((e: unknown) => {
      if (skillNameTaken(e)) throw new AssistantSkillNameTakenError();
      throw e;
    });
  }

  updateSkill(
    s: OwnerKey,
    id: string,
    patch: SkillPatch,
    opts: { expectedUpdatedAt?: Date; event?: SkillEventInput } = {},
  ): Promise<SkillRecord | null> {
    return this.#in(s, async (tx) => {
      const [current] = await tx
        .select()
        .from(sk)
        .where(and(eq(sk.id, id), ownsSkill(s)))
        .for('update');
      if (!current) return null;
      if (
        opts.expectedUpdatedAt &&
        current.updatedAt.getTime() !== opts.expectedUpdatedAt.getTime()
      ) {
        return null;
      }
      const values: Partial<Record<keyof typeof sk.$inferInsert, unknown>> = {
        updatedAt: nextSkillVersion,
      };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.description !== undefined) values.description = patch.description;
      if (patch.body !== undefined) values.body = patch.body;
      if (patch.toolsets !== undefined) values.toolsets = patch.toolsets;
      if (patch.state !== undefined) values.state = patch.state;
      if (patch.pinned !== undefined) values.pinned = patch.pinned;
      if (patch.countPatch) {
        values.patchCount = sql`${sk.patchCount} + 1`;
        values.lastPatchedAt = sql`now()`;
      }
      const [row] = await tx
        .update(sk)
        .set(values as Partial<typeof sk.$inferInsert>)
        .where(and(eq(sk.id, id), ownsSkill(s)))
        .returning();
      if (!row) return null;
      const updated = toSkill(row);
      if (opts.event) {
        await tx.insert(se).values({
          ...opts.event,
          accountId: s.accountId,
          ownerUserId: s.ownerUserId,
          skillId: id,
          before: skillSnapshot(toSkill(current)),
          after: skillSnapshot(updated),
        });
      }
      return updated;
    }).catch((e: unknown) => {
      if (skillNameTaken(e)) throw new AssistantSkillNameTakenError();
      throw e;
    });
  }

  bumpSkillCounter(s: OwnerKey, id: string, counter: 'use' | 'view'): Promise<void> {
    return this.#in(s, async (tx) => {
      const rows = await tx
        .update(sk)
        .set(
          counter === 'use'
            ? { useCount: sql`${sk.useCount} + 1`, lastUsedAt: sql`now()` }
            : { viewCount: sql`${sk.viewCount} + 1` },
        )
        .where(and(eq(sk.id, id), ownsSkill(s)))
        .returning({ id: sk.id });
      if (rows.length === 0) throw new AssistantNotFoundError('skill', id);
    });
  }

  appendSkillEvent(s: OwnerKey, e: NewSkillEvent): Promise<SkillEventRecord> {
    return this.#in(s, async (tx) => {
      const [owned] = await tx
        .select({ id: sk.id })
        .from(sk)
        .where(and(eq(sk.id, e.skillId), ownsSkill(s)));
      if (!owned) throw new AssistantNotFoundError('skill', e.skillId);
      const [row] = await tx
        .insert(se)
        .values({ ...e, accountId: s.accountId, ownerUserId: s.ownerUserId })
        .returning();
      if (!row) throw new Error('assistant skill event insert returned no row');
      return toSkillEvent(row);
    });
  }

  listSkillEvents(s: OwnerKey, q: SkillEventQuery): Promise<SkillEventRecord[]> {
    const limit = Math.min(q.limit ?? SKILL_EVENT_LIST_LIMIT, SKILL_EVENT_LIST_LIMIT);
    return this.#in(s, async (tx) => {
      const rows = await tx
        .select()
        .from(se)
        .where(
          and(
            ownsSkillEvent(s),
            q.skillId ? eq(se.skillId, q.skillId) : undefined,
            q.since ? gte(se.createdAt, q.since) : undefined,
            q.actor ? eq(se.actor, q.actor) : undefined,
          ),
        )
        .orderBy(desc(se.createdAt), desc(se.id))
        .limit(limit);
      return rows.map(toSkillEvent);
    });
  }

  getSkillEvent(s: OwnerKey, id: string): Promise<SkillEventRecord | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .select()
        .from(se)
        .where(and(eq(se.id, id), ownsSkillEvent(s)));
      return row ? toSkillEvent(row) : null;
    });
  }

  markSkillEventUndone(s: OwnerKey, id: string, at: Date): Promise<SkillEventRecord | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .update(se)
        .set({ undoneAt: at })
        .where(and(eq(se.id, id), ownsSkillEvent(s), isNull(se.undoneAt)))
        .returning();
      return row ? toSkillEvent(row) : null;
    });
  }

  // ─── Suggestions ───

  listSuggestions(s: OwnerKey, q: { status?: SuggestionStatus } = {}): Promise<SuggestionRecord[]> {
    return this.#in(s, async (tx) => {
      const rows = await tx
        .select()
        .from(sg)
        .where(and(ownsSuggestion(s), q.status ? eq(sg.status, q.status) : undefined))
        .orderBy(desc(sg.createdAt), desc(sg.id));
      return rows.map(toSuggestion);
    });
  }

  upsertSuggestion(s: OwnerKey, x: NewSuggestion): Promise<SuggestionRecord | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .insert(sg)
        .values({ ...x, accountId: s.accountId, ownerUserId: s.ownerUserId, status: 'pending' })
        .onConflictDoNothing({ target: [sg.accountId, sg.ownerUserId, sg.dedupKey] })
        .returning();
      return row ? toSuggestion(row) : null;
    });
  }

  decideSuggestion(
    s: OwnerKey,
    id: string,
    status: 'accepted' | 'dismissed',
    at: Date,
  ): Promise<SuggestionRecord | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .update(sg)
        .set({ status, decidedAt: at })
        .where(and(eq(sg.id, id), ownsSuggestion(s), eq(sg.status, 'pending')))
        .returning();
      return row ? toSuggestion(row) : null;
    });
  }

  // ─── Settings ───

  countToolUses(s: OwnerKey, since: Date): Promise<Record<string, number>> {
    return this.#in(s, async (tx) => {
      const rows = await tx
        .select({ tool: st.toolName, n: sql<number>`count(*)::int` })
        .from(st)
        .innerJoin(r, eq(r.id, st.runId))
        .where(
          and(
            eq(r.accountId, s.accountId),
            eq(r.ownerUserId, s.ownerUserId),
            eq(r.kind, 'chat'),
            gte(r.createdAt, since),
            eq(st.accountId, s.accountId),
            eq(st.kind, 'tool'),
          ),
        )
        .groupBy(st.toolName);
      const counts: Record<string, number> = {};
      for (const row of rows) if (row.tool) counts[row.tool] = Number(row.n);
      return counts;
    });
  }

  getSettings(s: OwnerKey): Promise<AssistantSettingsRecord> {
    return this.#in(s, async (tx) => {
      const [row] = await tx.select().from(set_).where(ownsSettings(s));
      return row ? toSettings(row) : { ...DEFAULT_ASSISTANT_SETTINGS, disabledToolsets: [] };
    });
  }

  saveSettings(s: OwnerKey, patch: SettingsPatch): Promise<AssistantSettingsRecord> {
    return this.#in(s, async (tx) => {
      const values: Partial<typeof set_.$inferInsert> = {};
      if (patch.reviewEnabled !== undefined) values.reviewEnabled = patch.reviewEnabled;
      if (patch.disabledToolsets !== undefined) values.disabledToolsets = patch.disabledToolsets;
      if (patch.curatorRanAt !== undefined) values.curatorRanAt = patch.curatorRanAt;
      const [row] = await tx
        .insert(set_)
        .values({ ...values, accountId: s.accountId, ownerUserId: s.ownerUserId })
        .onConflictDoUpdate({
          target: [set_.accountId, set_.ownerUserId],
          set: { ...values, updatedAt: sql`now()` },
        })
        .returning();
      if (!row) throw new Error('assistant settings upsert returned no row');
      return toSettings(row);
    });
  }

  // ─── Feedback ───

  setFeedback(s: OwnerKey, messageId: string, value: MessageFeedback | null): Promise<void> {
    return this.#in(s, async (tx) => {
      // The thread join re-checks the owner on the thread row, not only on the message.
      const rows = await tx
        .update(m)
        .set({ feedback: value })
        .where(
          and(
            eq(m.id, messageId),
            ownsMessage(s),
            eq(m.role, 'assistant'),
            eq(m.isSummary, false),
            sql`exists (select 1 from assistant_threads at where at.id = ${m.threadId}
              and at.account_id = ${s.accountId} and at.owner_user_id = ${s.ownerUserId})`,
          ),
        )
        .returning({ id: m.id });
      if (rows.length === 0) throw new AssistantNotFoundError('message', messageId);
    });
  }

  // ─── Review counters ───

  bumpReviewCounters(
    s: OwnerKey,
    threadId: string,
    by: { ownerTurns: number; toolRounds: number },
  ): Promise<ReviewCounters> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .update(t)
        .set({
          reviewOwnerTurns: sql`${t.reviewOwnerTurns} + ${by.ownerTurns}`,
          reviewToolRounds: sql`${t.reviewToolRounds} + ${by.toolRounds}`,
        })
        .where(and(eq(t.id, threadId), ownsThread(s)))
        .returning({
          ownerTurns: t.reviewOwnerTurns,
          toolRounds: t.reviewToolRounds,
          lastReviewAt: t.lastReviewAt,
        });
      if (!row) throw new AssistantNotFoundError('thread', threadId);
      return row;
    });
  }

  resetReviewCounters(
    s: OwnerKey,
    threadId: string,
    opts: { only?: 'ownerTurns' | 'toolRounds'; reviewedAt?: Date } = {},
  ): Promise<ReviewCounters> {
    return this.#in(s, async (tx) => {
      const values: Partial<typeof t.$inferInsert> = {};
      if (opts.only !== 'toolRounds') values.reviewOwnerTurns = 0;
      if (opts.only !== 'ownerTurns') values.reviewToolRounds = 0;
      if (opts.reviewedAt) values.lastReviewAt = opts.reviewedAt;
      const [row] = await tx
        .update(t)
        .set(values)
        .where(and(eq(t.id, threadId), ownsThread(s)))
        .returning({
          ownerTurns: t.reviewOwnerTurns,
          toolRounds: t.reviewToolRounds,
          lastReviewAt: t.lastReviewAt,
        });
      if (!row) throw new AssistantNotFoundError('thread', threadId);
      return row;
    });
  }

  // ─── Jobs ───

  enqueueJob(s: OwnerKey, j: NewJob): Promise<JobRecord> {
    return this.#in(s, async (tx) => {
      if (j.threadId) await this.#ownThread(tx, s, j.threadId);
      // The partial unique index (NULLS NOT DISTINCT) keeps one queued job per owner, thread
      // and kind; a concurrent enqueue lands on the conflict branch instead of a second row. A
      // due job keeps its run_after (an idle enqueue never pushes a counter-triggered review
      // back), and two scopes merge into `combined`.
      const rows = await tx.execute<RawJob>(sql`
        insert into assistant_jobs
          (id, account_id, owner_user_id, thread_id, kind, review_scope, status, run_after)
        values (${j.id}, ${s.accountId}, ${s.ownerUserId}, ${j.threadId}, ${j.kind},
                ${j.reviewScope}, 'queued', ${j.runAfter.toISOString()}::timestamptz)
        on conflict (account_id, owner_user_id, kind, thread_id) where status = 'queued'
        do update set
          run_after = case when assistant_jobs.run_after <= now()
            then assistant_jobs.run_after else excluded.run_after end,
          review_scope = case
            when assistant_jobs.review_scope is not null and excluded.review_scope is not null
              and assistant_jobs.review_scope <> excluded.review_scope then 'combined'
            else excluded.review_scope end,
          created_at = now()
        returning *`);
      const [row] = [...rows];
      if (!row) throw new Error('assistant job upsert returned no row');
      return rawJob(row);
    });
  }

  getJob(s: OwnerKey, id: string): Promise<JobRecord | null> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .select()
        .from(jb)
        .where(and(eq(jb.id, id), ownsJob(s)));
      return row ? toJob(row) : null;
    });
  }

  claimJobs(now: Date, limit: number, leaseMs: number): Promise<JobRecord[]> {
    const at = now.toISOString();
    return this.#sys(async (tx) => {
      // A job whose holder died JOB_MAX_ATTEMPTS times is not retried forever.
      await tx.execute(sql`
        update assistant_jobs set status = 'failed', error_code = 'lease_expired',
          finished_at = ${at}::timestamptz, lease_until = null
        where status = 'running' and lease_until < ${at}::timestamptz
          and attempts >= ${JOB_MAX_ATTEMPTS}`);
      const rows = await tx.execute<RawJob>(sql`
        with picked as (
          select id from assistant_jobs
          where (status = 'queued' and run_after <= ${at}::timestamptz)
             or (status = 'running' and lease_until < ${at}::timestamptz)
          order by run_after, id
          limit ${limit}
          for update skip locked)
        update assistant_jobs j
        set status = 'running',
            lease_until = ${at}::timestamptz + ${leaseMs}::int * interval '1 millisecond',
            attempts = j.attempts + 1
        from picked where j.id = picked.id
        returning j.*`);
      return [...rows].map(rawJob).sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime());
    });
  }

  finishJob(
    s: OwnerKey,
    job: { id: string; attempts: number },
    outcome: { status: 'done' | 'failed'; errorCode?: string | null },
  ): Promise<boolean> {
    return this.#in(s, async (tx) => {
      const rows = await tx
        .update(jb)
        .set({
          status: outcome.status,
          errorCode: outcome.errorCode ?? null,
          finishedAt: sql`now()`,
          leaseUntil: null,
        })
        .where(
          and(
            eq(jb.id, job.id),
            ownsJob(s),
            eq(jb.status, 'running'),
            eq(jb.attempts, job.attempts),
          ),
        )
        .returning({ id: jb.id });
      return rows.length > 0;
    });
  }

  retryJob(
    s: OwnerKey,
    job: { id: string; attempts: number },
    retry: { runAfter: Date; errorCode: string },
  ): Promise<boolean> {
    return this.#in(s, async (tx) => {
      const [row] = await tx
        .select({ threadId: jb.threadId, kind: jb.kind, reviewScope: jb.reviewScope })
        .from(jb)
        .where(
          and(
            eq(jb.id, job.id),
            ownsJob(s),
            eq(jb.status, 'running'),
            eq(jb.attempts, job.attempts),
          ),
        )
        .for('update');
      if (!row) return false;
      // The queued-job unique index allows one queued job per owner, thread and kind.
      const [sibling] = await tx
        .select({ id: jb.id, reviewScope: jb.reviewScope })
        .from(jb)
        .where(
          and(
            ownsJob(s),
            eq(jb.status, 'queued'),
            eq(jb.kind, row.kind),
            row.threadId === null ? isNull(jb.threadId) : eq(jb.threadId, row.threadId),
          ),
        )
        .for('update');
      if (sibling) {
        // Merged into the queued job: it runs no later than the retry, with both scopes, and is
        // re-stamped so it no longer reads as an idle review that later messages push back.
        await tx
          .update(jb)
          .set({
            runAfter: sql`least(${jb.runAfter}, ${retry.runAfter.toISOString()}::timestamptz)`,
            reviewScope:
              sibling.reviewScope && row.reviewScope && sibling.reviewScope !== row.reviewScope
                ? 'combined'
                : (sibling.reviewScope ?? row.reviewScope),
            createdAt: sql`now()`,
          })
          .where(and(eq(jb.id, sibling.id), eq(jb.status, 'queued')));
      }
      await tx
        .update(jb)
        .set(
          sibling
            ? {
                status: 'failed',
                errorCode: retry.errorCode,
                finishedAt: sql`now()`,
                leaseUntil: null,
              }
            : {
                status: 'queued',
                errorCode: retry.errorCode,
                runAfter: retry.runAfter,
                leaseUntil: null,
              },
        )
        .where(eq(jb.id, job.id));
      return true;
    });
  }

  cancelJob(
    s: OwnerKey,
    target: { id: string; attempts?: number } | { threadId: string; kind: JobKind },
  ): Promise<number> {
    return this.#in(s, async (tx) => {
      const which =
        'id' in target
          ? target.attempts === undefined
            ? eq(jb.id, target.id)
            : and(eq(jb.id, target.id), eq(jb.attempts, target.attempts))
          : and(eq(jb.threadId, target.threadId), eq(jb.kind, target.kind));
      const rows = await tx
        .update(jb)
        .set({ status: 'cancelled', finishedAt: sql`now()`, leaseUntil: null })
        .where(and(which, ownsJob(s), inArray(jb.status, ['queued', 'running'])))
        .returning({ id: jb.id });
      return rows.length;
    });
  }

  // ─── Curator ───

  listLearnedSkillsForCurator(s: OwnerKey): Promise<SkillRecord[]> {
    return this.listSkills(s, { provenance: ['learned'], states: ['active', 'stale'] });
  }

  ownersWithLearnedSkills(opts: { ranBefore?: Date } = {}): Promise<OwnerKey[]> {
    return this.#sys(async (tx) => {
      const ranBefore = opts.ranBefore
        ? sql`and (st.curator_ran_at is null
            or st.curator_ran_at < ${opts.ranBefore.toISOString()}::timestamptz)`
        : sql``;
      const rows = await tx.execute<{ account_id: string; owner_user_id: string }>(sql`
        select distinct s.account_id, s.owner_user_id
        from assistant_skills s
        left join assistant_settings st
          on st.account_id = s.account_id and st.owner_user_id = s.owner_user_id
        where s.provenance = 'learned' and s.state in ('active', 'stale') ${ranBefore}
        order by s.account_id, s.owner_user_id`);
      return [...rows].map((r) => ({
        accountId: r.account_id,
        ownerUserId: r.owner_user_id as OwnerKey['ownerUserId'],
      }));
    });
  }
}
