import {
  and,
  asc,
  desc,
  eq,
  or,
  schema,
  sql,
  withAccount,
  type Database,
  type TenantTx,
} from '@agent-sales/db';

import { AssistantNotFoundError, AssistantRunIdTakenError } from '../../domain/assistant.errors.js';
import type { OwnerScope } from '../../domain/owner-scope.js';
import {
  type AssistantRepository,
  type MessageRecord,
  type RunRecord,
  RUN_BUSY_WINDOW_MS,
  type SearchHit,
  type StepRecord,
  THREAD_LIST_LIMIT,
  type ThreadRecord,
} from '../../domain/ports/assistant.repository.js';
import { snippetAround } from '../../domain/search-text.js';

const t = schema.assistantThreads;
const m = schema.assistantMessages;
const r = schema.assistantRuns;
const st = schema.assistantRunSteps;

/** SQLSTATE of a driver error (drizzle wraps the postgres error in `cause`). */
const pgCode = (e: unknown): string | undefined =>
  (e as { cause?: { code?: string } } | null)?.cause?.code ?? (e as { code?: string } | null)?.code;

/** `%text%` for ILIKE, with the wildcards the owner typed taken literally. */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const ownsThread = (s: OwnerScope) =>
  and(eq(t.accountId, s.accountId), eq(t.ownerUserId, s.ownerUserId));
const ownsMessage = (s: OwnerScope) =>
  and(eq(m.accountId, s.accountId), eq(m.ownerUserId, s.ownerUserId));
const ownsRun = (s: OwnerScope) =>
  and(eq(r.accountId, s.accountId), eq(r.ownerUserId, s.ownerUserId));

function toThread(row: typeof t.$inferSelect): ThreadRecord {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    archived: row.archived,
    businessId: row.businessId,
    systemPrompt: row.systemPrompt,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt,
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
 * Assistant storage on PostgreSQL (ADR-022): every call runs in one `withAccount` transaction
 * (RLS on `account_id`) and filters by account AND owner explicitly, so a second owner of the
 * same account sees nothing of the first. Thread/run ownership is checked in the same
 * transaction before any read or write by id.
 */
export class DrizzleAssistantRepository implements AssistantRepository {
  constructor(private readonly db: Database) {}

  #in<T>(s: OwnerScope, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return withAccount(this.db, s.accountId, fn);
  }

  /** The owner's thread row, locked for update when asked; NOT_FOUND otherwise. */
  async #ownThread(tx: TenantTx, s: OwnerScope, threadId: string, lock = false) {
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
                and am.role in ('user', 'assistant')
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

  getThread(s: OwnerScope, threadId: string): Promise<ThreadRecord | null> {
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
        .orderBy(asc(m.seq));
      return rows.map(toMessage);
    });
  }

  appendMessages(
    s: OwnerScope,
    threadId: string,
    msgs: Omit<MessageRecord, 'seq' | 'createdAt' | 'threadId'>[],
  ): Promise<MessageRecord[]> {
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
          and am.role in ('user', 'assistant')
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
}
