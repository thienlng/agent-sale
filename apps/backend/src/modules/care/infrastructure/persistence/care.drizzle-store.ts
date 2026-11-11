import {
  and,
  type Database,
  desc,
  eq,
  gte,
  inArray,
  lt,
  ne,
  schema,
  sql,
  type TenantTx,
  withSystem,
  withTenant,
  writeAudit,
} from '@agent-sales/db';
import type { AutonomyLevel, CareTemplateKey } from '@agent-sales/contracts';
import { newId, workspaceId as asWorkspaceId, type WorkspaceId } from '@agent-sales/shared';

import { AFTER_SALE_LISTED_MS, type MessageTemplate, type StopReason } from '../../domain/care.js';
import type {
  CareJob,
  CareJobRef,
  CareMessage,
  CareStore,
  CareTemplateRow,
  NewCareMessage,
} from '../../domain/ports/care.store.js';

const tp = schema.careTemplates;
const en = schema.careEnrollments;
const cm = schema.careMessages;
const us = schema.careUsage;

/** The actor of everything the agent does on its own (audit trail). */
const AI_ACTOR = 'ai:care';

const toMessage = (r: typeof cm.$inferSelect): CareMessage => ({
  id: r.id,
  conversationId: r.conversationId,
  enrollmentId: r.enrollmentId,
  anchorAt: r.anchorAt,
  template: r.template,
  step: r.step,
  level: r.level,
  text: r.text,
  status: r.status,
  skipReason: r.skipReason,
  windowClosesAt: r.windowClosesAt,
  scheduledFor: r.sendAt,
  sentMessageId: r.sentMessageId,
  sentAt: r.sentAt,
  decidedBy: r.decidedBy,
  decidedAt: r.decidedAt,
  createdAt: r.createdAt,
});

/** Messages a person approved that have not gone out yet, and drafts: what a stop expires. */
const OPEN_STATUSES = ['draft', 'scheduled'] as const;

/** The cycle is still active at the claimed anchor and step (a restarted cycle is not touched). */
const activeAt = (ws: WorkspaceId, job: CareJobRef) =>
  and(
    eq(en.workspaceId, ws),
    eq(en.id, job.id),
    eq(en.status, 'active'),
    eq(en.anchorAt, job.anchorAt),
    eq(en.step, job.step),
  );

const isUuidLike = (v: string | null): v is string =>
  v !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function audit(
  tx: TenantTx,
  ws: WorkspaceId,
  action: string,
  targetId: string,
  data: Record<string, unknown>,
  actor: string | null,
): Promise<void> {
  await writeAudit(tx, {
    workspaceId: ws,
    actorUserId: isUuidLike(actor) ? actor : null,
    actorName: isUuidLike(actor) ? null : AI_ACTOR,
    action,
    targetType: 'care_message',
    targetId,
    data,
  });
}

type RawJob = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  template: MessageTemplate;
  step: number;
  anchor_at: string | Date;
  next_at: string | Date;
  attempts: number;
};

/**
 * Care tables through Drizzle. Tenant methods run in `withTenant` (RLS); the worker's claims and
 * expiry run on the system login (`withSystem`), across businesses.
 */
export class DrizzleCareStore implements CareStore {
  constructor(
    private readonly db: Database,
    private readonly systemDb: Database,
  ) {}

  templates(ws: WorkspaceId): Promise<CareTemplateRow[]> {
    return withTenant(this.db, ws, async (tx) =>
      (await tx.select().from(tp).where(eq(tp.workspaceId, ws))).map((r) => ({
        key: r.key,
        enabled: r.enabled,
        instruction: r.instruction,
        params: r.params as CareTemplateRow['params'],
      })),
    );
  }

  putTemplate(ws: WorkspaceId, row: CareTemplateRow, now: Date): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      const values = {
        enabled: row.enabled,
        instruction: row.instruction,
        params: row.params,
        updatedAt: now,
      };
      await tx
        .insert(tp)
        .values({ workspaceId: ws, key: row.key, ...values })
        .onConflictDoUpdate({ target: [tp.workspaceId, tp.key], set: values });
      if (!row.enabled) {
        // Turning a template off ends its running cycles and their drafts.
        const stopped = await tx
          .update(en)
          .set({ status: 'stopped', stopReason: 'template_off', leaseUntil: null, updatedAt: now })
          .where(and(eq(en.workspaceId, ws), eq(en.template, row.key), eq(en.status, 'active')))
          .returning({ conversationId: en.conversationId });
        const ids = stopped.map((s) => s.conversationId);
        if (ids.length) {
          await tx
            .update(cm)
            .set({ status: 'expired', updatedAt: now })
            .where(
              and(
                eq(cm.workspaceId, ws),
                eq(cm.template, row.key),
                inArray(cm.status, [...OPEN_STATUSES]),
                inArray(cm.conversationId, ids),
              ),
            );
        }
      }
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
      const row = rows[0];
      return row !== undefined && (limit === null || row.count <= limit);
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

  enroll(
    ws: WorkspaceId,
    e: { conversationId: string; template: CareTemplateKey; anchorAt: Date; nextAt: Date },
    now: Date,
  ): Promise<boolean> {
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx
        .insert(en)
        .values({
          id: newId(),
          workspaceId: ws,
          conversationId: e.conversationId,
          template: e.template,
          step: 0,
          anchorAt: e.anchorAt,
          nextAt: e.nextAt,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [en.workspaceId, en.conversationId, en.template],
          set: {
            step: 0,
            anchorAt: e.anchorAt,
            nextAt: e.nextAt,
            status: 'active',
            stopReason: null,
            leaseUntil: null,
            attempts: 0,
            updatedAt: now,
          },
          // Only a newer anchor restarts the cycle (an event read twice changes nothing).
          setWhere: sql`${en.anchorAt} < ${e.anchorAt.toISOString()}::timestamptz`,
        })
        .returning({ id: en.id });
      return rows.length > 0;
    });
  }

  stopConversation(
    ws: WorkspaceId,
    conversationId: string,
    templates: readonly CareTemplateKey[],
    reason: StopReason,
    now: Date,
    onlyDueBy?: Date,
  ): Promise<number> {
    if (!templates.length) return Promise.resolve(0);
    return withTenant(this.db, ws, async (tx) => {
      const stopped = await tx
        .update(en)
        .set({ status: 'stopped', stopReason: reason, leaseUntil: null, updatedAt: now })
        .where(
          and(
            eq(en.workspaceId, ws),
            eq(en.conversationId, conversationId),
            eq(en.status, 'active'),
            inArray(en.template, [...templates]),
            onlyDueBy ? sql`${en.nextAt} <= ${onlyDueBy.toISOString()}::timestamptz` : undefined,
          ),
        )
        .returning({ id: en.id });
      if (templates.some((t) => t !== 'after_sale')) {
        await tx
          .update(cm)
          .set({ status: 'expired', updatedAt: now })
          .where(
            and(
              eq(cm.workspaceId, ws),
              eq(cm.conversationId, conversationId),
              inArray(cm.status, [...OPEN_STATUSES]),
            ),
          );
      }
      return stopped.length;
    });
  }

  claimDue(now: Date, limit: number, leaseMs: number): Promise<CareJob[]> {
    const lease = new Date(now.getTime() + leaseMs).toISOString();
    const at = now.toISOString();
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx.execute<RawJob>(sql`
        update care_enrollments e
           set lease_until = ${lease}::timestamptz, attempts = e.attempts + 1
          from (
            select id from care_enrollments
             where status = 'active' and template <> 'after_sale'
               and next_at <= ${at}::timestamptz
               and (lease_until is null or lease_until <= ${at}::timestamptz)
             order by next_at
             limit ${limit}
             for update skip locked
          ) due
         where e.id = due.id
        returning e.id, e.workspace_id, e.conversation_id, e.template, e.step, e.anchor_at,
                  e.next_at, e.attempts`);
      return rows.map((r) => ({
        id: r.id,
        workspaceId: asWorkspaceId(r.workspace_id),
        conversationId: r.conversation_id,
        template: r.template,
        step: Number(r.step),
        anchorAt: new Date(r.anchor_at),
        nextAt: new Date(r.next_at),
        attempts: Number(r.attempts),
      }));
    });
  }

  advance(ws: WorkspaceId, job: CareJobRef, step: number, nextAt: Date, now: Date): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(en)
        .set({ step, nextAt, leaseUntil: null, attempts: 0, updatedAt: now })
        .where(activeAt(ws, job));
    });
  }

  finish(ws: WorkspaceId, job: CareJobRef, now: Date): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(en)
        .set({ status: 'done', leaseUntil: null, updatedAt: now })
        .where(activeAt(ws, job));
    });
  }

  stop(ws: WorkspaceId, job: CareJobRef, reason: StopReason, now: Date): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      const [row] = await tx
        .update(en)
        .set({ status: 'stopped', stopReason: reason, leaseUntil: null, updatedAt: now })
        .where(activeAt(ws, job))
        .returning({ conversationId: en.conversationId });
      if (row) {
        await tx
          .update(cm)
          .set({ status: 'expired', updatedAt: now })
          .where(
            and(
              eq(cm.workspaceId, ws),
              eq(cm.conversationId, row.conversationId),
              inArray(cm.status, [...OPEN_STATUSES]),
            ),
          );
      }
    });
  }

  reschedule(ws: WorkspaceId, job: CareJobRef, at: Date, resetAttempts: boolean): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(en)
        .set({
          nextAt: at,
          leaseUntil: null,
          ...(resetAttempts ? { attempts: 0 } : {}),
          updatedAt: new Date(),
        })
        .where(activeAt(ws, job));
    });
  }

  afterSaleDue(ws: WorkspaceId, before: Date, now: Date): Promise<string[]> {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select({ conversationId: en.conversationId })
          .from(en)
          .where(
            and(
              eq(en.workspaceId, ws),
              eq(en.status, 'active'),
              eq(en.template, 'after_sale'),
              lt(en.nextAt, before),
              gte(en.nextAt, new Date(now.getTime() - AFTER_SALE_LISTED_MS)),
            ),
          )
          .orderBy(en.nextAt)
          .limit(1000)
      ).map((r) => r.conversationId),
    );
  }

  insertMessage(ws: WorkspaceId, m: NewCareMessage): Promise<boolean> {
    return withTenant(this.db, ws, async (tx) => {
      // The step's unique index (enrollment, anchor, step): a repeated step writes nothing.
      const inserted = await tx
        .insert(cm)
        .values({
          id: m.id,
          workspaceId: ws,
          conversationId: m.conversationId,
          enrollmentId: m.enrollmentId,
          anchorAt: m.anchorAt,
          template: m.template,
          step: m.step,
          level: m.level,
          text: m.text.slice(0, 2000),
          skipReason: m.skipReason?.slice(0, 200) ?? null,
          status: m.status,
          windowClosesAt: m.windowClosesAt,
          model: m.model?.slice(0, 120) ?? null,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          createdAt: m.createdAt,
          updatedAt: m.createdAt,
        })
        .onConflictDoNothing()
        .returning({ id: cm.id });
      if (!inserted.length) return false;
      if (m.status === 'draft') {
        // A new draft replaces the conversation's older ones.
        await tx
          .update(cm)
          .set({ status: 'expired', updatedAt: m.createdAt })
          .where(
            and(
              eq(cm.workspaceId, ws),
              eq(cm.conversationId, m.conversationId),
              eq(cm.status, 'draft'),
              ne(cm.id, m.id),
            ),
          );
      }
      const action =
        m.status === 'draft'
          ? 'care.message.drafted'
          : m.status === 'skipped'
            ? 'care.message.skipped'
            : 'care.message.sending';
      await audit(
        tx,
        ws,
        action,
        m.id,
        {
          conversationId: m.conversationId,
          template: m.template,
          step: m.step,
          level: m.level,
          ...(m.skipReason ? { skipReason: m.skipReason.slice(0, 200) } : {}),
        },
        null,
      );
      return true;
    });
  }

  stepMessage(
    ws: WorkspaceId,
    enrollmentId: string,
    anchorAt: Date,
    step: number,
  ): Promise<CareMessage | null> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select()
        .from(cm)
        .where(
          and(
            eq(cm.workspaceId, ws),
            eq(cm.enrollmentId, enrollmentId),
            eq(cm.anchorAt, anchorAt),
            eq(cm.step, step),
          ),
        );
      return r ? toMessage(r) : null;
    });
  }

  getMessage(ws: WorkspaceId, id: string): Promise<CareMessage | null> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select()
        .from(cm)
        .where(and(eq(cm.workspaceId, ws), eq(cm.id, id)));
      return r ? toMessage(r) : null;
    });
  }

  messagesOf(ws: WorkspaceId, conversationId: string, limit: number): Promise<CareMessage[]> {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select()
          .from(cm)
          .where(and(eq(cm.workspaceId, ws), eq(cm.conversationId, conversationId)))
          .orderBy(desc(cm.createdAt))
          .limit(limit)
      ).map(toMessage),
    );
  }

  drafts(ws: WorkspaceId, limit: number): Promise<CareMessage[]> {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select()
          .from(cm)
          .where(and(eq(cm.workspaceId, ws), eq(cm.status, 'draft')))
          .orderBy(desc(cm.createdAt))
          .limit(limit)
      ).map(toMessage),
    );
  }

  scheduled(ws: WorkspaceId, limit: number): Promise<CareMessage[]> {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select()
          .from(cm)
          .where(and(eq(cm.workspaceId, ws), eq(cm.status, 'scheduled')))
          .orderBy(cm.sendAt)
          .limit(limit)
      ).map(toMessage),
    );
  }

  claimDraft(
    ws: WorkspaceId,
    id: string,
    by: string,
    now: Date,
    opts: { text?: string | undefined; sendAt?: Date | undefined } = {},
  ): Promise<CareMessage | null> {
    const later = opts.sendAt !== undefined;
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .update(cm)
        .set({
          status: later ? 'scheduled' : 'sending',
          sendAt: later ? (opts.sendAt ?? null) : null,
          ...(opts.text !== undefined ? { text: opts.text.slice(0, 2000) } : {}),
          decidedBy: by,
          decidedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(cm.workspaceId, ws),
            eq(cm.id, id),
            eq(cm.status, 'draft'),
            sql`(${cm.windowClosesAt} is null or ${cm.windowClosesAt} > ${now.toISOString()}::timestamptz)`,
          ),
        )
        .returning();
      if (r) {
        if (later)
          await audit(
            tx,
            ws,
            'care.message.scheduled',
            id,
            { conversationId: r.conversationId, sendAt: r.sendAt?.toISOString() ?? null },
            by,
          );
        return toMessage(r);
      }
      await tx
        .update(cm)
        .set({ status: 'expired', updatedAt: now })
        .where(
          and(
            eq(cm.workspaceId, ws),
            eq(cm.id, id),
            eq(cm.status, 'draft'),
            sql`${cm.windowClosesAt} <= ${now.toISOString()}::timestamptz`,
          ),
        );
      return null;
    });
  }

  dueScheduled(now: Date, limit: number): Promise<{ workspaceId: WorkspaceId; id: string }[]> {
    return withSystem(this.systemDb, async (tx) =>
      (
        await tx
          .select({ workspaceId: cm.workspaceId, id: cm.id })
          .from(cm)
          .where(
            and(eq(cm.status, 'scheduled'), sql`${cm.sendAt} <= ${now.toISOString()}::timestamptz`),
          )
          .orderBy(cm.sendAt)
          .limit(limit)
      ).map((r) => ({ workspaceId: asWorkspaceId(r.workspaceId), id: r.id })),
    );
  }

  claimScheduled(ws: WorkspaceId, id: string, now: Date): Promise<CareMessage | null> {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .update(cm)
        .set({ status: 'sending', updatedAt: now })
        .where(
          and(
            eq(cm.workspaceId, ws),
            eq(cm.id, id),
            eq(cm.status, 'scheduled'),
            sql`${cm.sendAt} <= ${now.toISOString()}::timestamptz`,
          ),
        )
        .returning();
      return r ? toMessage(r) : null;
    });
  }

  deferScheduled(ws: WorkspaceId, id: string, at: Date, now: Date): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(cm)
        .set({ sendAt: at, updatedAt: now })
        .where(and(eq(cm.workspaceId, ws), eq(cm.id, id), eq(cm.status, 'scheduled')));
    });
  }

  expireMessage(ws: WorkspaceId, id: string, reason: string, now: Date): Promise<boolean> {
    return withTenant(this.db, ws, async (tx) => {
      const [row] = await tx
        .update(cm)
        .set({ status: 'expired', skipReason: reason.slice(0, 200), updatedAt: now })
        .where(and(eq(cm.workspaceId, ws), eq(cm.id, id), inArray(cm.status, [...OPEN_STATUSES])))
        .returning({ conversationId: cm.conversationId });
      if (!row) return false;
      await audit(
        tx,
        ws,
        'care.message.expired',
        id,
        { conversationId: row.conversationId, reason: reason.slice(0, 200) },
        null,
      );
      return true;
    });
  }

  finishSend(
    ws: WorkspaceId,
    id: string,
    r: {
      status: 'sent' | 'failed' | 'expired';
      text: string;
      sentMessageId: string | null;
      reason: string | null;
      actor: string | null;
    },
    now: Date,
  ): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      const [row] = await tx
        .update(cm)
        .set({
          status: r.status,
          text: r.text.slice(0, 2000),
          sentMessageId: r.sentMessageId,
          sentAt: r.status === 'sent' ? now : null,
          skipReason: r.reason?.slice(0, 200) ?? null,
          updatedAt: now,
        })
        .where(and(eq(cm.workspaceId, ws), eq(cm.id, id), eq(cm.status, 'sending')))
        .returning({ conversationId: cm.conversationId, level: cm.level });
      if (!row) return;
      await audit(
        tx,
        ws,
        `care.message.${r.status}`,
        id,
        {
          conversationId: row.conversationId,
          level: row.level,
          approved: r.actor !== null,
          ...(r.reason ? { reason: r.reason } : {}),
        },
        r.actor,
      );
    });
  }

  rejectDraft(ws: WorkspaceId, id: string, by: string, now: Date): Promise<boolean> {
    return withTenant(this.db, ws, async (tx) => {
      const [row] = await tx
        .update(cm)
        .set({ status: 'rejected', decidedBy: by, decidedAt: now, updatedAt: now })
        .where(and(eq(cm.workspaceId, ws), eq(cm.id, id), eq(cm.status, 'draft')))
        .returning({ conversationId: cm.conversationId });
      if (!row) return false;
      await audit(tx, ws, 'care.message.rejected', id, { conversationId: row.conversationId }, by);
      return true;
    });
  }

  sentTimes(
    ws: WorkspaceId,
    conversationId: string,
    since: Date,
    exceptId?: string,
  ): Promise<Date[]> {
    // A send in flight or interrupted may have reached the customer: it counts (at its start).
    const at = sql<Date | string>`coalesce(${cm.sentAt}, ${cm.sendAt}, ${cm.updatedAt})`;
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select({ at })
          .from(cm)
          .where(
            and(
              eq(cm.workspaceId, ws),
              eq(cm.conversationId, conversationId),
              sql`(${cm.status} in ('sent','sending','scheduled')
                or (${cm.status} = 'failed' and ${cm.skipReason} = 'interrupted'))`,
              sql`${at} >= ${since.toISOString()}::timestamptz`,
              exceptId ? ne(cm.id, exceptId) : undefined,
            ),
          )
      ).map((r) => new Date(r.at)),
    );
  }

  sentBetween(
    ws: WorkspaceId,
    q: { since: Date; until: Date; level?: AutonomyLevel; limit: number },
  ): Promise<CareMessage[]> {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select()
          .from(cm)
          .where(
            and(
              eq(cm.workspaceId, ws),
              eq(cm.status, 'sent'),
              gte(cm.sentAt, q.since),
              lt(cm.sentAt, q.until),
              q.level ? eq(cm.level, q.level) : undefined,
            ),
          )
          .orderBy(desc(cm.sentAt))
          .limit(q.limit)
      ).map(toMessage),
    );
  }

  expireDue(now: Date, staleBefore: Date): Promise<number> {
    return withSystem(this.systemDb, async (tx) => {
      const expired = await tx
        .update(cm)
        .set({ status: 'expired', updatedAt: now })
        .where(
          and(
            inArray(cm.status, [...OPEN_STATUSES]),
            sql`${cm.windowClosesAt} <= ${now.toISOString()}::timestamptz`,
          ),
        )
        .returning({ id: cm.id });
      const stale = await tx
        .update(cm)
        .set({ status: 'failed', skipReason: 'interrupted', updatedAt: now })
        .where(
          and(
            eq(cm.status, 'sending'),
            sql`${cm.updatedAt} <= ${staleBefore.toISOString()}::timestamptz`,
          ),
        )
        .returning({ id: cm.id });
      // An after-sales check-in leaves Today 7 days after it became due: its cycle is done.
      const listedSince = new Date(now.getTime() - AFTER_SALE_LISTED_MS).toISOString();
      const done = await tx
        .update(en)
        .set({ status: 'done', leaseUntil: null, updatedAt: now })
        .where(
          and(
            eq(en.status, 'active'),
            eq(en.template, 'after_sale'),
            sql`${en.nextAt} < ${listedSince}::timestamptz`,
          ),
        )
        .returning({ id: en.id });
      return expired.length + stale.length + done.length;
    });
  }
}
