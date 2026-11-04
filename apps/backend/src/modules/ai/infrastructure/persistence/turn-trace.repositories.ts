import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  type Database,
  schema,
  sql,
  withSystem,
  withTenant,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { AiRunRecord } from '../../domain/ports/ai-run.repository.js';
import {
  AROUND_AFTER_MS,
  AROUND_BEFORE_MS,
  isSignalStep,
  SIGNAL_TOOL_NAMES,
  type TurnListFilter,
  type TurnRow,
  type TurnStepRecord,
  type TurnTraceRecord,
  type TurnTraceRepository,
} from '../../domain/ports/turn-trace.repository.js';
import type { InMemoryAiRunRepository } from './ai-run.repositories.js';

type RunRow = typeof schema.aiRuns.$inferSelect;
type TraceRow = typeof schema.aiRunTraces.$inferSelect;
type StepRow = typeof schema.aiRunSteps.$inferSelect;

const iso = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/** Escapes `\`, `%` and `_` for a LIKE pattern (default escape character `\`). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toRun(r: RunRow): AiRunRecord {
  return {
    id: r.id,
    botId: r.botId,
    conversationId: r.conversationId,
    tier: r.tier,
    provider: r.provider,
    model: r.model,
    promptVersion: r.promptVersion,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedTokens: r.cachedTokens,
    latencyMs: r.latencyMs,
    retrieved: (r.retrieved ?? []) as AiRunRecord['retrieved'],
    outcome: r.outcome as AiRunRecord['outcome'],
    guardrail: r.guardrail,
    isTest: r.isTest,
    productIds: r.productIds ?? [],
    createdAt: r.createdAt,
  };
}

function toTrace(t: TraceRow): TurnTraceRecord {
  return {
    runId: t.runId,
    botId: t.botId,
    conversationId: t.conversationId,
    startedAt: t.startedAt,
    channel: t.channel,
    commentReply: t.commentReply,
    historyTurns: t.historyTurns,
    historySummarized: t.historySummarized,
    customerImages: t.customerImages,
    queryExcerpt: t.queryExcerpt,
    replyExcerpt: t.replyExcerpt,
    scenarioIds: t.scenarioIds ?? [],
    focusProductIds: t.focusProductIds ?? [],
    actionIds: t.actionIds ?? [],
    pendingAction: t.pendingAction,
    offeredTools: t.offeredTools ?? [],
    systemPromptSha: t.systemPromptSha,
    situationsSha: t.situationsSha,
    modelCalls: t.modelCalls,
    loopOutcome: t.loopOutcome,
    messagesSent: t.messagesSent,
    messagesUndelivered: t.messagesUndelivered,
  };
}

function toStep(s: StepRow): TurnStepRecord {
  return {
    idx: s.idx,
    kind: s.kind,
    toolName: s.toolName,
    ok: s.ok,
    errorCode: s.errorCode,
    ms: s.ms,
    detail: s.detail ?? null,
  };
}

const r = schema.aiRuns;
const t = schema.aiRunTraces;
const st = schema.aiRunSteps;

export class DrizzleTurnTraceRepository implements TurnTraceRepository {
  constructor(
    private readonly db: Database,
    /** System connection for the cross-tenant purge; without it `purgeExpired` is a no-op. */
    private readonly systemDb?: Database | null,
  ) {}

  async record(ws: WorkspaceId, trace: TurnTraceRecord, steps: TurnStepRecord[]): Promise<void> {
    await withTenant(this.db, ws, async (tx) => {
      await tx.insert(t).values({ ...trace, workspaceId: ws });
      if (steps.length > 0) {
        await tx
          .insert(st)
          .values(steps.map((s) => ({ ...s, runId: trace.runId, workspaceId: ws })));
      }
    });
  }

  async list(ws: WorkspaceId, f: TurnListFilter): Promise<TurnRow[]> {
    const start = sql`coalesce(${t.startedAt}, ${r.createdAt} - ${r.latencyMs} * interval '1 millisecond')`;
    const conditions = [
      eq(r.workspaceId, ws),
      eq(r.botId, f.botId),
      gte(r.createdAt, f.from),
      lte(r.createdAt, f.to),
      f.conversationId ? eq(r.conversationId, f.conversationId) : undefined,
      f.includeTests ? undefined : eq(r.isTest, false),
      f.q
        ? sql`assistant_unaccent(coalesce(${t.queryExcerpt}, '') || ' ' || coalesce(${t.replyExcerpt}, '')) ilike '%' || assistant_unaccent(${escapeLike(f.q)}) || '%'`
        : undefined,
    ];
    let distance: ReturnType<typeof sql> | null = null;
    if (f.around) {
      const at = iso(f.around);
      conditions.push(
        sql`${at} between ${start} - interval '${sql.raw(String(AROUND_BEFORE_MS))} milliseconds' and ${r.createdAt} + interval '${sql.raw(String(AROUND_AFTER_MS))} milliseconds'`,
      );
      distance = sql`greatest(extract(epoch from ${start} - ${at}), extract(epoch from ${at} - ${r.createdAt}), 0)`;
    } else if (f.cursor) {
      conditions.push(
        sql`(${r.createdAt}, ${r.id}) < (${iso(f.cursor.createdAt)}, ${f.cursor.runId}::uuid)`,
      );
    }
    const rows = await withTenant(this.db, ws, (tx) =>
      tx
        .select({ run: r, trace: t })
        .from(r)
        .leftJoin(t, and(eq(t.runId, r.id), eq(t.workspaceId, ws)))
        .where(and(...conditions))
        .orderBy(...(distance ? [distance] : []), desc(r.createdAt), desc(r.id))
        .limit(f.limit),
    );
    return rows.map((row) => ({
      run: toRun(row.run),
      trace: row.trace ? toTrace(row.trace) : null,
    }));
  }

  async get(
    ws: WorkspaceId,
    botId: string,
    runId: string,
  ): Promise<(TurnRow & { steps: TurnStepRecord[] }) | null> {
    return withTenant(this.db, ws, async (tx) => {
      const [row] = await tx
        .select({ run: r, trace: t })
        .from(r)
        .leftJoin(t, and(eq(t.runId, r.id), eq(t.workspaceId, ws)))
        .where(and(eq(r.workspaceId, ws), eq(r.botId, botId), eq(r.id, runId)))
        .limit(1);
      if (!row) return null;
      const steps = await tx
        .select()
        .from(st)
        .where(and(eq(st.workspaceId, ws), eq(st.runId, runId)))
        .orderBy(st.idx);
      return {
        run: toRun(row.run),
        trace: row.trace ? toTrace(row.trace) : null,
        steps: steps.map(toStep),
      };
    });
  }

  async signalSteps(ws: WorkspaceId, runIds: string[]): Promise<Map<string, TurnStepRecord[]>> {
    const out = new Map<string, TurnStepRecord[]>();
    if (runIds.length === 0) return out;
    const rows = await withTenant(this.db, ws, (tx) =>
      tx
        .select()
        .from(st)
        .where(
          and(
            eq(st.workspaceId, ws),
            inArray(st.runId, runIds),
            sql`(${st.ok} = false or ${st.errorCode} is not null or ${inArray(st.toolName, [...SIGNAL_TOOL_NAMES])} or ${st.toolName} like 'action\\_%')`,
          ),
        )
        .orderBy(st.runId, st.idx),
    );
    for (const row of rows) {
      const list = out.get(row.runId) ?? [];
      list.push(toStep(row));
      out.set(row.runId, list);
    }
    return out;
  }

  async purgeExpired(before: Date, batch: number): Promise<number> {
    if (!this.systemDb) return 0;
    return withSystem(this.systemDb, async (tx) => {
      const [lock] = await tx
        .select({ ok: sql<boolean>`pg_try_advisory_xact_lock(hashtext('ai_trace_purge'))` })
        .from(sql`(select 1) as one`);
      if (!lock?.ok) return 0;
      const steps = await tx
        .delete(st)
        .where(
          sql`ctid in (select ctid from ai_run_steps where created_at < ${iso(before)} limit ${batch})`,
        )
        .returning({ runId: st.runId });
      const traces = await tx
        .delete(t)
        .where(
          sql`ctid in (select ctid from ai_run_traces where created_at < ${iso(before)} limit ${batch})`,
        )
        .returning({ runId: t.runId });
      return steps.length + traces.length;
    });
  }
}

interface StoredTrace {
  ws: WorkspaceId;
  trace: TurnTraceRecord;
  steps: TurnStepRecord[];
  createdAt: Date;
}

/** Unaccented, lowercase form (mirrors `assistant_unaccent(...) ILIKE`). */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Same semantics as the Drizzle repository, over an in-memory ai_runs store (the
 * `InMemoryAiRunRepository` the service writes runs to).
 */
export class InMemoryTurnTraceRepository implements TurnTraceRepository {
  readonly traces: StoredTrace[] = [];
  /** Set to make `record` throw (tests of the best-effort write). */
  failWith: Error | null = null;

  constructor(
    private readonly runs: InMemoryAiRunRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(ws: WorkspaceId, trace: TurnTraceRecord, steps: TurnStepRecord[]): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.traces.push({ ws, trace, steps: steps.map((s) => ({ ...s })), createdAt: this.now() });
  }

  #trace(ws: WorkspaceId, runId: string): StoredTrace | undefined {
    const exists = this.runs.runs.some((r) => r.workspaceId === ws && r.id === runId);
    return exists ? this.traces.find((x) => x.ws === ws && x.trace.runId === runId) : undefined;
  }

  async list(ws: WorkspaceId, f: TurnListFilter): Promise<TurnRow[]> {
    const q = f.q ? fold(f.q) : null;
    const at = f.around?.getTime();
    const rows = this.runs.runs
      .filter(
        (run) =>
          run.workspaceId === ws &&
          run.botId === f.botId &&
          run.createdAt >= f.from &&
          run.createdAt <= f.to &&
          (!f.conversationId || run.conversationId === f.conversationId) &&
          (f.includeTests || !run.isTest),
      )
      .map((run) => {
        const { workspaceId: _ws, ...plain } = run;
        const stored = this.#trace(ws, run.id);
        return { run: plain as AiRunRecord, trace: stored ? { ...stored.trace } : null };
      })
      .filter((row) => {
        if (!q) return true;
        const hay = fold(`${row.trace?.queryExcerpt ?? ''} ${row.trace?.replyExcerpt ?? ''}`);
        return row.trace !== null && hay.includes(q);
      });
    const byNewest = (a: TurnRow, b: TurnRow) =>
      b.run.createdAt.getTime() - a.run.createdAt.getTime() || (b.run.id < a.run.id ? -1 : 1);
    if (at !== undefined) {
      const start = (row: TurnRow) =>
        row.trace?.startedAt.getTime() ?? row.run.createdAt.getTime() - row.run.latencyMs;
      const distance = (row: TurnRow) =>
        Math.max(start(row) - at, at - row.run.createdAt.getTime(), 0);
      return rows
        .filter(
          (row) =>
            at >= start(row) - AROUND_BEFORE_MS &&
            at <= row.run.createdAt.getTime() + AROUND_AFTER_MS,
        )
        .sort((a, b) => distance(a) - distance(b) || byNewest(a, b))
        .slice(0, f.limit);
    }
    const cursor = f.cursor;
    return rows
      .filter((row) => {
        if (!cursor) return true;
        const c = row.run.createdAt.getTime() - cursor.createdAt.getTime();
        return c < 0 || (c === 0 && row.run.id < cursor.runId);
      })
      .sort(byNewest)
      .slice(0, f.limit);
  }

  async get(
    ws: WorkspaceId,
    botId: string,
    runId: string,
  ): Promise<(TurnRow & { steps: TurnStepRecord[] }) | null> {
    const run = this.runs.runs.find(
      (x) => x.workspaceId === ws && x.botId === botId && x.id === runId,
    );
    if (!run) return null;
    const { workspaceId: _ws, ...plain } = run;
    const stored = this.#trace(ws, runId);
    return {
      run: plain as AiRunRecord,
      trace: stored ? { ...stored.trace } : null,
      steps: stored ? stored.steps.map((s) => ({ ...s })) : [],
    };
  }

  async signalSteps(ws: WorkspaceId, runIds: string[]): Promise<Map<string, TurnStepRecord[]>> {
    const out = new Map<string, TurnStepRecord[]>();
    for (const runId of runIds) {
      const steps = this.#trace(ws, runId)?.steps.filter(isSignalStep) ?? [];
      if (steps.length > 0)
        out.set(
          runId,
          steps.map((s) => ({ ...s })),
        );
    }
    return out;
  }

  async purgeExpired(before: Date, batch: number): Promise<number> {
    let deleted = 0;
    let stepBudget = batch;
    for (const stored of this.traces) {
      if (stored.createdAt >= before || stepBudget === 0) continue;
      const n = Math.min(stepBudget, stored.steps.length);
      stored.steps.splice(0, n);
      stepBudget -= n;
      deleted += n;
    }
    let traceBudget = batch;
    for (let i = this.traces.length - 1; i >= 0 && traceBudget > 0; i--) {
      const stored = this.traces[i];
      if (stored && stored.createdAt < before) {
        this.traces.splice(i, 1);
        traceBudget -= 1;
        deleted += 1;
      }
    }
    return deleted;
  }
}
