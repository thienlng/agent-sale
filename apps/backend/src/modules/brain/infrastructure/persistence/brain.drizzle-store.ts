import {
  and,
  type Database,
  desc,
  eq,
  inArray,
  or,
  schema,
  sql,
  type TenantTx,
  withSystem,
  withTenant,
  writeAudit,
  writeOutbox,
} from '@agent-sales/db';
import { BRAIN_SIGNALS_UPDATED, type BrainSignalsUpdatedPayload } from '@agent-sales/contracts';
import { newId, workspaceId as asWorkspaceId, type WorkspaceId } from '@agent-sales/shared';

import type {
  BrainStore,
  BriefingState,
  SignalJob,
  SignalRunRecord,
  TodaySignalRef,
} from '../../domain/ports/brain.store.js';
import type { AutonomyAction, AutonomyLevel } from '../../domain/autonomy.js';
import type { BrainSettings } from '../../domain/schedule.js';
import type { ConversationSignal, StageChange } from '../../domain/signal.js';

const cs = schema.conversationSignals;
const jb = schema.signalJobs;
const us = schema.signalUsage;
const st = schema.brainSettings;
const au = schema.autonomySettings;

const toSignal = (r: typeof cs.$inferSelect): ConversationSignal => ({
  conversationId: r.conversationId,
  contactId: r.contactId,
  stage: r.stage,
  intent: r.intent,
  mood: r.mood,
  needsHuman: r.needsHuman,
  needsHumanReason: r.needsHumanReason,
  followUpAt: r.followUpAt,
  followUpReason: r.followUpReason,
  note: r.note,
  evaluatedUntil: r.evaluatedUntil,
  evaluatedAt: r.evaluatedAt,
  stageLocked: r.stageLocked,
  dismissedUntilMessageAfter: r.dismissedUntilMessageAfter,
  optOut: r.optOut,
  version: r.version,
  updatedAt: r.updatedAt,
});

type RawJob = {
  workspace_id: string;
  conversation_id: string;
  trigger: SignalJob['trigger'];
  run_after: string | Date;
  attempts: number;
};

/**
 * `brain.signals.updated.v1` in the same transaction as the signal row (the care agent enrolls
 * and stops from it, ADR-031).
 */
async function publishUpdated(
  tx: TenantTx,
  ws: WorkspaceId,
  r: typeof cs.$inferSelect,
  at: Date,
): Promise<void> {
  const payload: BrainSignalsUpdatedPayload = {
    conversationId: r.conversationId,
    stage: r.stage,
    optOut: r.optOut,
    version: r.version,
    occurredAt: at.toISOString(),
  };
  await writeOutbox(tx, {
    workspaceId: ws,
    type: BRAIN_SIGNALS_UPDATED,
    aggregateType: 'conversation',
    aggregateId: r.conversationId,
    payload,
  });
}

/** A foreign-key violation: the conversation was deleted before its job was written. */
const isMissingConversation = (e: unknown): boolean => {
  const code = (x: unknown) => (x as { code?: unknown } | null)?.code;
  return code(e) === '23503' || code((e as { cause?: unknown } | null)?.cause) === '23503';
};

/**
 * Brain tables through Drizzle. Tenant methods run in `withTenant` (RLS); the worker's claims and
 * resets run on the system login (`withSystem`), across businesses.
 */
export class DrizzleBrainStore implements BrainStore {
  constructor(
    private readonly db: Database,
    private readonly systemDb: Database,
  ) {}

  getSettings(ws: WorkspaceId): Promise<BrainSettings | null> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx.select().from(st).where(eq(st.workspaceId, ws));
      return r
        ? {
            mode: r.mode,
            idleMinutes: r.idleMinutes,
            briefingEnabled: r.briefingEnabled,
            briefingHour: r.briefingHour,
          }
        : null;
    });
  }

  putSettings(ws: WorkspaceId, s: BrainSettings): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      const values = {
        mode: s.mode,
        idleMinutes: s.idleMinutes,
        briefingEnabled: s.briefingEnabled,
        briefingHour: s.briefingHour,
      };
      await tx
        .insert(st)
        .values({ workspaceId: ws, ...values })
        .onConflictDoUpdate({ target: st.workspaceId, set: values });
    });
  }

  getAutonomy(ws: WorkspaceId): Promise<{ action: AutonomyAction; level: AutonomyLevel }[]> {
    return withTenant(this.db, ws, (tx) =>
      tx.select({ action: au.action, level: au.level }).from(au).where(eq(au.workspaceId, ws)),
    );
  }

  putAutonomy(
    ws: WorkspaceId,
    rows: readonly { action: AutonomyAction; level: AutonomyLevel }[],
    actorId: string | null,
    now: Date,
  ): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      for (const r of rows) {
        const [prev] = await tx
          .select({ level: au.level })
          .from(au)
          .where(and(eq(au.workspaceId, ws), eq(au.action, r.action)));
        await tx
          .insert(au)
          .values({
            workspaceId: ws,
            action: r.action,
            level: r.level,
            updatedBy: actorId,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [au.workspaceId, au.action],
            set: { level: r.level, updatedBy: actorId, updatedAt: now },
          });
        if (prev?.level !== r.level) {
          await writeAudit(tx, {
            workspaceId: ws,
            actorUserId: actorId,
            actorName: null,
            action: 'brain.autonomy.updated',
            targetType: 'autonomy_setting',
            targetId: r.action,
            data: { from: prev?.level ?? null, to: r.level },
          });
        }
      }
    });
  }

  getSignal(ws: WorkspaceId, conversationId: string): Promise<ConversationSignal | null> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select()
        .from(cs)
        .where(and(eq(cs.workspaceId, ws), eq(cs.conversationId, conversationId)));
      return r ? toSignal(r) : null;
    });
  }

  signalsFor(ws: WorkspaceId, ids: readonly string[]): Promise<ConversationSignal[]> {
    if (!ids.length) return Promise.resolve([]);
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select()
          .from(cs)
          .where(and(eq(cs.workspaceId, ws), inArray(cs.conversationId, [...ids])))
      ).map(toSignal),
    );
  }

  saveEvaluation(
    ws: WorkspaceId,
    s: ConversationSignal,
    lastCustomerMessageAt: Date | null,
  ): Promise<ConversationSignal> {
    return withTenant(this.db, ws, async (tx) => {
      const model = {
        contactId: s.contactId,
        intent: s.intent,
        mood: s.mood,
        needsHuman: s.needsHuman,
        needsHumanReason: s.needsHumanReason,
        followUpAt: s.followUpAt,
        followUpReason: s.followUpReason,
        note: s.note,
        optOut: s.optOut,
        evaluatedUntil: s.evaluatedUntil,
        evaluatedAt: s.evaluatedAt,
        updatedAt: s.updatedAt,
      };
      const newer = lastCustomerMessageAt?.toISOString() ?? null;
      const [r] = await tx
        .insert(cs)
        .values({
          workspaceId: ws,
          conversationId: s.conversationId,
          ...model,
          stage: s.stage,
          version: 1,
        })
        .onConflictDoUpdate({
          target: [cs.workspaceId, cs.conversationId],
          // The member-owned columns are re-read from the stored row, not from the evaluation's
          // starting point: a lock, stage or dismissal written meanwhile wins.
          set: {
            ...model,
            contactId: sql`coalesce(excluded.contact_id, ${cs.contactId})`,
            // Two evaluations racing never move the covered time back (greatest skips nulls).
            evaluatedUntil: sql`greatest(${cs.evaluatedUntil}, excluded.evaluated_until)`,
            stage: sql`case when ${cs.stageLocked} then ${cs.stage} else excluded.stage end`,
            dismissedUntilMessageAfter: sql`case
              when ${newer}::timestamptz > ${cs.dismissedUntilMessageAfter} then null
              else ${cs.dismissedUntilMessageAfter} end`,
            version: sql`${cs.version} + 1`,
          },
        })
        .returning();
      if (!r) throw new Error('signal not written');
      await publishUpdated(tx, ws, r, s.updatedAt);
      return toSignal(r);
    });
  }

  saveStage(
    ws: WorkspaceId,
    conversationId: string,
    contactId: string | null,
    change: StageChange,
    now: Date,
  ): Promise<ConversationSignal> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .insert(cs)
        .values({
          workspaceId: ws,
          conversationId,
          contactId,
          stage: change.stage ?? 'new',
          stageLocked: change.stageLocked,
          version: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [cs.workspaceId, cs.conversationId],
          set: {
            stage: change.stage ?? sql`${cs.stage}`,
            stageLocked: change.stageLocked,
            version: sql`${cs.version} + 1`,
            updatedAt: now,
          },
        })
        .returning();
      if (!r) throw new Error('signal not written');
      await publishUpdated(tx, ws, r, now);
      return toSignal(r);
    });
  }

  dismissSignal(
    ws: WorkspaceId,
    conversationId: string,
    contactId: string | null,
    at: Date,
  ): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .insert(cs)
        .values({
          workspaceId: ws,
          conversationId,
          contactId,
          dismissedUntilMessageAfter: at,
          version: 1,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [cs.workspaceId, cs.conversationId],
          set: {
            dismissedUntilMessageAfter: at,
            version: sql`${cs.version} + 1`,
            updatedAt: at,
          },
        });
    });
  }

  undismissSignal(ws: WorkspaceId, conversationId: string, at: Date): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(cs)
        .set({
          dismissedUntilMessageAfter: null,
          version: sql`${cs.version} + 1`,
          updatedAt: at,
        })
        .where(and(eq(cs.workspaceId, ws), eq(cs.conversationId, conversationId)));
    });
  }

  async scheduleJob(ws: WorkspaceId, conversationId: string, due: Date): Promise<void> {
    try {
      await withTenant(this.db, ws, async (tx) => {
        await tx
          .insert(jb)
          .values({
            workspaceId: ws,
            conversationId,
            trigger: 'idle',
            runAfter: due,
            status: 'pending',
          })
          .onConflictDoUpdate({
            target: [jb.workspaceId, jb.conversationId],
            set: {
              runAfter: sql`greatest(${jb.runAfter}, excluded.run_after)`,
              status: 'pending',
              trigger: 'idle',
              attempts: 0,
            },
          });
      });
    } catch (e) {
      if (!isMissingConversation(e)) throw e;
    }
  }

  claimDueJobs(now: Date, limit: number, leaseMs: number): Promise<SignalJob[]> {
    const at = now.toISOString();
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx.execute<RawJob>(sql`
        with picked as (
          select workspace_id, conversation_id from signal_jobs
          where status = 'pending' and run_after <= ${at}::timestamptz
            and (lease_until is null or lease_until < ${at}::timestamptz)
          order by run_after
          limit ${limit}
          for update skip locked)
        update signal_jobs j
        set lease_until = ${at}::timestamptz + ${leaseMs}::int * interval '1 millisecond',
            attempts = j.attempts + 1
        from picked
        where j.workspace_id = picked.workspace_id and j.conversation_id = picked.conversation_id
        returning j.workspace_id, j.conversation_id, j.trigger, j.run_after, j.attempts`);
      return [...rows].map((r) => ({
        workspaceId: asWorkspaceId(r.workspace_id),
        conversationId: r.conversation_id,
        trigger: r.trigger,
        runAfter: new Date(r.run_after),
        attempts: Number(r.attempts),
      }));
    });
  }

  finishJob(ws: WorkspaceId, conversationId: string, claimedRunAfter: Date): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      const key = and(eq(jb.workspaceId, ws), eq(jb.conversationId, conversationId));
      await tx.delete(jb).where(and(key, sql`${jb.runAfter} <= ${claimedRunAfter.toISOString()}`));
      // A newer customer message moved it: it stays, free to be claimed when due, with its own
      // attempts.
      await tx.update(jb).set({ leaseUntil: null, attempts: 0 }).where(key);
    });
  }

  capJob(ws: WorkspaceId, conversationId: string, until: Date): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(jb)
        .set({ status: 'capped', runAfter: until, leaseUntil: null, attempts: 0 })
        .where(and(eq(jb.workspaceId, ws), eq(jb.conversationId, conversationId)));
    });
  }

  retryJob(ws: WorkspaceId, conversationId: string, retryAt: Date): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(jb)
        .set({
          runAfter: sql`greatest(${jb.runAfter}, ${retryAt.toISOString()}::timestamptz)`,
          leaseUntil: null,
        })
        .where(and(eq(jb.workspaceId, ws), eq(jb.conversationId, conversationId)));
    });
  }

  resetCappedJobs(now: Date, runAfter: Date): Promise<number> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .update(jb)
        .set({ status: 'pending', runAfter })
        .where(and(eq(jb.status, 'capped'), sql`${jb.runAfter} <= ${now.toISOString()}`))
        .returning({ id: jb.conversationId });
      return rows.length;
    });
  }

  reserveUsage(ws: WorkspaceId, day: string, limit: number | null): Promise<boolean> {
    if (limit !== null && limit <= 0) return Promise.resolve(false);
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx
        .insert(us)
        .values({ workspaceId: ws, day, count: 1 })
        .onConflictDoUpdate({
          target: [us.workspaceId, us.day],
          set: { count: sql`${us.count} + 1` },
          ...(limit === null ? {} : { setWhere: sql`${us.count} < ${limit}` }),
        })
        .returning({ count: us.count });
      return rows.length > 0;
    });
  }

  releaseUsage(ws: WorkspaceId, day: string): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(us)
        .set({ count: sql`greatest(${us.count} - 1, 0)` })
        .where(and(eq(us.workspaceId, ws), eq(us.day, day)));
    });
  }

  usedOn(ws: WorkspaceId, day: string): Promise<number> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select({ count: us.count })
        .from(us)
        .where(and(eq(us.workspaceId, ws), eq(us.day, day)));
      return r?.count ?? 0;
    });
  }

  recordRun(ws: WorkspaceId, run: SignalRunRecord): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx.insert(schema.signalRuns).values({ id: newId(), workspaceId: ws, ...run });
    });
  }

  todaySignalRefs(
    ws: WorkspaceId,
    q: { now: Date; readySince: Date; priceSince: Date; limit: number },
  ): Promise<TodaySignalRef[]> {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select({
            conversationId: cs.conversationId,
            attention: sql<boolean>`(${cs.mood} = 'complaint' or ${cs.needsHuman})`,
          })
          .from(cs)
          .where(
            and(
              eq(cs.workspaceId, ws),
              or(
                eq(cs.mood, 'complaint'),
                eq(cs.needsHuman, true),
                and(
                  eq(cs.stage, 'ready'),
                  sql`coalesce(${cs.evaluatedAt}, ${cs.updatedAt}) >= ${q.readySince.toISOString()}::timestamptz`,
                ),
                and(
                  eq(cs.stage, 'price_asked'),
                  sql`coalesce(${cs.evaluatedUntil}, ${cs.evaluatedAt}, ${cs.updatedAt}) >= ${q.priceSince.toISOString()}::timestamptz`,
                ),
                sql`${cs.followUpAt} <= ${q.now.toISOString()}::timestamptz`,
              ),
            ),
          )
          .orderBy(desc(cs.updatedAt))
          .limit(q.limit)
      ).map((r) => ({ conversationId: r.conversationId, attention: Boolean(r.attention) })),
    );
  }

  pendingJobIds(ws: WorkspaceId, limit: number): Promise<string[]> {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select({ id: jb.conversationId })
          .from(jb)
          .where(eq(jb.workspaceId, ws))
          .orderBy(jb.runAfter)
          .limit(limit)
      ).map((r) => r.id),
    );
  }

  briefingStates(ids: readonly WorkspaceId[]): Promise<BriefingState[]> {
    if (!ids.length) return Promise.resolve([]);
    return withSystem(this.systemDb, async (tx) =>
      (
        await tx
          .select({
            workspaceId: st.workspaceId,
            briefingEnabled: st.briefingEnabled,
            briefingHour: st.briefingHour,
            lastBriefingDay: st.lastBriefingDay,
          })
          .from(st)
          .where(inArray(st.workspaceId, [...ids]))
      ).map((r) => ({ ...r, workspaceId: asWorkspaceId(r.workspaceId) })),
    );
  }

  claimBriefing(ws: WorkspaceId, day: string): Promise<boolean> {
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx
        .insert(st)
        .values({ workspaceId: ws, lastBriefingDay: day })
        .onConflictDoUpdate({
          target: st.workspaceId,
          set: { lastBriefingDay: day },
          setWhere: sql`${st.lastBriefingDay} is null or ${st.lastBriefingDay} < ${day}::date`,
        })
        .returning({ id: st.workspaceId });
      return rows.length > 0;
    });
  }
}
