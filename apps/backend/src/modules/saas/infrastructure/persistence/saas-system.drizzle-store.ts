import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  schema,
  sql,
  withSystem,
  type Database,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  DueReminder,
  HqLease,
  HqOutboxRow,
  SaasSystemStore,
} from '../../application/ports/saas-system-store.js';

const CONSUMER = 'saas.hq_sync';
const o = schema.outboxEvents;
const s = schema.saasSubscriptions;
const cp = schema.saasHqCheckpoints;

const xid = (n: number) => sql`${String(n)}::xid8`;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/**
 * Cross-tenant reads and the HQ consumer position (app_system). The outbox window works like the
 * analytics projector (`DrizzleProjectionStore`): rows of transactions that finished between the
 * last horizon and the oldest transaction still running.
 */
export class DrizzleSaasSystemStore implements SaasSystemStore {
  constructor(private readonly systemDb: Database) {}

  withHqLease<T>(fn: (lease: HqLease) => Promise<T>): Promise<T | null> {
    return withSystem(this.systemDb, async (tx) => {
      const got = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${CONSUMER})) as ok`,
      );
      if (!got[0]?.ok) return null;
      const [row] = await tx
        .select({ horizon: cp.horizon })
        .from(cp)
        .where(eq(cp.consumer, CONSUMER));
      const from = row?.horizon ?? 0;
      const [hz] = await tx.execute<{ h: string }>(
        sql`select pg_snapshot_xmin(pg_current_snapshot())::text::bigint as h`,
      );
      const to = Number(hz?.h ?? 0);
      return fn({
        async readBatch(types, afterId, limit) {
          if (to <= from || !types.length) return [];
          const rows = await tx
            .select({ id: o.id, type: o.type, payload: o.payload })
            .from(o)
            .where(
              and(
                gt(o.id, afterId),
                isNull(o.workspaceId),
                inArray(o.type, [...types]),
                sql`${o.txId} >= ${xid(from)} and ${o.txId} < ${xid(to)}`,
              ),
            )
            .orderBy(asc(o.id))
            .limit(limit);
          return rows as HqOutboxRow[];
        },
        async commit() {
          if (to <= from) return;
          await tx
            .insert(cp)
            .values({ consumer: CONSUMER, horizon: to })
            .onConflictDoUpdate({
              target: cp.consumer,
              set: { horizon: to, updatedAt: new Date() },
            });
        },
        async deadLetter(r, error) {
          await tx
            .insert(schema.saasHqDeadLetters)
            .values({ outboxId: r.id, type: r.type, error })
            .onConflictDoNothing();
        },
      });
    });
  }

  claimDaily(job: string, day: string): Promise<boolean> {
    const n = dayNumber(day);
    return withSystem(this.systemDb, async (tx) => {
      // `horizon` holds the last day number the job ran for: one winner per day.
      const rows = await tx
        .insert(cp)
        .values({ consumer: job, horizon: n })
        .onConflictDoUpdate({
          target: cp.consumer,
          set: { horizon: n, updatedAt: new Date() },
          setWhere: sql`${cp.horizon} < ${n}`,
        })
        .returning({ consumer: cp.consumer });
      return rows.length > 0;
    });
  }

  dueReminders(
    w: Record<'trial_ending' | 'renewal_due', { from: string; to: string }>,
  ): Promise<DueReminder[]> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select({
          workspaceId: s.workspaceId,
          contactId: s.contactId,
          stage: s.stage,
          trialEndsOn: s.trialEndsOn,
          renewsOn: s.renewsOn,
          remindersSent: s.remindersSent,
        })
        .from(s)
        .where(
          and(
            isNull(s.externalSource),
            sql`((${s.stage} = 'trial' and ${s.trialEndsOn} between ${w.trial_ending.from}::date and ${w.trial_ending.to}::date)
              or (${s.stage} = 'active' and ${s.renewsOn} between ${w.renewal_due.from}::date and ${w.renewal_due.to}::date))`,
          ),
        )
        .orderBy(asc(s.workspaceId), asc(s.id))
        .limit(5000);
      return rows.map((r) => {
        const trial = r.stage === 'trial';
        return {
          workspaceId: r.workspaceId as WorkspaceId,
          contactId: r.contactId,
          kind: trial ? ('trial_ending' as const) : ('renewal_due' as const),
          dueOn: (trial ? r.trialEndsOn : r.renewsOn) as string,
          remindersSent: r.remindersSent,
        };
      });
    });
  }

  markReminderSent(ws: WorkspaceId, contactId: string, key: string, at: Date): Promise<void> {
    return withSystem(this.systemDb, async (tx) => {
      await tx
        .update(s)
        .set({
          remindersSent: sql`${s.remindersSent} || jsonb_build_object(${key}::text, ${at.toISOString()}::text)`,
        })
        .where(and(eq(s.workspaceId, ws), eq(s.contactId, contactId)));
    });
  }
}
