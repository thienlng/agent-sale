import {
  type Database,
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  schema,
  sql,
  withSystem,
  withTenant,
  writeAudit,
} from '@agent-sales/db';
import { workspaceId as asWorkspaceId } from '@agent-sales/shared';

import type { DataExportStore } from '../../application/ports/data-export-store.js';
import type { DataExportRecord } from '../../domain/data-export.js';
import { DataExportInProgressError } from '../../domain/dataexport.errors.js';

const t = schema.dataExports;

/** The row is still being built by this attempt (no other worker took the lease over). */
const held = (id: string, attempt: number) =>
  and(eq(t.id, id), eq(t.status, 'running'), eq(t.attempts, attempt));

function isUniqueViolation(e: unknown): boolean {
  for (let c: unknown = e; c && typeof c === 'object'; c = (c as { cause?: unknown }).cause)
    if ((c as { code?: unknown }).code === '23505') return true;
  return false;
}
type Row = typeof t.$inferSelect;

function toRecord(r: Row): DataExportRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    requestedByUserId: r.requestedByUserId,
    requestedByName: r.requestedByName,
    includeMedia: r.includeMedia,
    status: r.status,
    attempts: r.attempts,
    objectKey: r.objectKey,
    sizeBytes: r.sizeBytes,
    errorCode: r.errorCode,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    expiresAt: r.expiresAt,
  };
}

/** `data_exports` (0070). `tenant` runs under RLS; `system` is the worker and link download. */
export class DrizzleDataExportStore implements DataExportStore {
  constructor(
    private readonly tenant: Database,
    private readonly system: Database,
  ) {}

  list(ws: string, limit: number): Promise<DataExportRecord[]> {
    return withTenant(this.tenant, asWorkspaceId(ws), async (tx) =>
      (
        await tx
          .select()
          .from(t)
          .where(eq(t.workspaceId, ws))
          .orderBy(desc(t.createdAt))
          .limit(limit)
      ).map(toRecord),
    );
  }

  get(ws: string, id: string): Promise<DataExportRecord | null> {
    return withTenant(this.tenant, asWorkspaceId(ws), async (tx) => {
      const [r] = await tx
        .select()
        .from(t)
        .where(and(eq(t.workspaceId, ws), eq(t.id, id)));
      return r ? toRecord(r) : null;
    });
  }

  countSince(ws: string, since: Date): Promise<number> {
    return withTenant(this.tenant, asWorkspaceId(ws), async (tx) => {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(t)
        .where(
          and(
            eq(t.workspaceId, ws),
            gte(t.createdAt, since),
            inArray(t.status, ['queued', 'running', 'ready', 'expired']),
          ),
        );
      return r?.n ?? 0;
    });
  }

  hasActive(ws: string): Promise<boolean> {
    return withTenant(this.tenant, asWorkspaceId(ws), async (tx) => {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(t)
        .where(and(eq(t.workspaceId, ws), inArray(t.status, ['queued', 'running'])));
      return (r?.n ?? 0) > 0;
    });
  }

  create(input: Parameters<DataExportStore['create']>[0]): Promise<DataExportRecord> {
    const ws = asWorkspaceId(input.workspaceId);
    return withTenant(this.tenant, ws, async (tx) => {
      const [r] = await tx
        .insert(t)
        .values({
          id: input.id,
          workspaceId: ws,
          requestedByUserId: input.requestedByUserId,
          requestedByName: input.requestedByName,
          includeMedia: input.includeMedia,
        })
        .returning();
      await writeAudit(tx, {
        workspaceId: ws,
        actorUserId: input.requestedByUserId,
        actorName: input.requestedByName,
        action: 'workspace.data_exported',
        targetType: 'data_export',
        targetId: input.id,
        data: { includeMedia: input.includeMedia },
      });
      if (!r) throw new Error('data_exports insert returned no row');
      return toRecord(r);
    }).catch((e: unknown) => {
      // data_exports_active_idx: one queued or running export per workspace.
      if (isUniqueViolation(e)) throw new DataExportInProgressError();
      throw e;
    });
  }

  setLink(ws: string, id: string, tokenHash: string, expiresAt: Date): Promise<boolean> {
    return withTenant(this.tenant, asWorkspaceId(ws), async (tx) => {
      const rows = await tx
        .update(t)
        .set({ downloadTokenHash: tokenHash, downloadTokenExpiresAt: expiresAt })
        .where(and(eq(t.workspaceId, ws), eq(t.id, id), eq(t.status, 'ready')))
        .returning({ id: t.id });
      return rows.length === 1;
    });
  }

  claim(now: Date, leaseMs: number, maxAttempts: number): Promise<DataExportRecord | null> {
    return withSystem(this.system, async (tx) => {
      const lease = new Date(now.getTime() + leaseMs);
      const rows = await tx.execute<{ id: string }>(sql`
        with picked as (
          select id from data_exports
          where status = 'queued'
             or (status = 'running' and lease_until < ${now.toISOString()}::timestamptz
                 and attempts < ${maxAttempts})
          order by created_at
          limit 1
          for update skip locked
        )
        update data_exports d
          set status = 'running', lease_until = ${lease.toISOString()}::timestamptz, attempts = d.attempts + 1
          from picked where d.id = picked.id
          returning d.id`);
      const id = rows[0]?.id;
      if (!id) return null;
      const [r] = await tx.select().from(t).where(eq(t.id, id));
      return r ? toRecord(r) : null;
    });
  }

  failLapsed(now: Date, maxAttempts: number): Promise<DataExportRecord[]> {
    return withSystem(this.system, async (tx) =>
      (
        await tx
          .update(t)
          .set({ status: 'failed', errorCode: 'lease_expired', finishedAt: now, leaseUntil: null })
          .where(and(eq(t.status, 'running'), lt(t.leaseUntil, now), gte(t.attempts, maxAttempts)))
          .returning()
      ).map(toRecord),
    );
  }

  renewLease(id: string, attempt: number, until: Date): Promise<boolean> {
    return withSystem(
      this.system,
      async (tx) =>
        (
          await tx
            .update(t)
            .set({ leaseUntil: until })
            .where(held(id, attempt))
            .returning({ id: t.id })
        ).length === 1,
    );
  }

  finishReady(
    id: string,
    attempt: number,
    r: { objectKey: string; sizeBytes: number; at: Date; expiresAt: Date },
  ): Promise<boolean> {
    return withSystem(
      this.system,
      async (tx) =>
        (
          await tx
            .update(t)
            .set({
              status: 'ready',
              objectKey: r.objectKey,
              sizeBytes: r.sizeBytes,
              finishedAt: r.at,
              expiresAt: r.expiresAt,
              leaseUntil: null,
              errorCode: null,
            })
            .where(held(id, attempt))
            .returning({ id: t.id })
        ).length === 1,
    );
  }

  finishFailed(id: string, attempt: number, errorCode: string, at: Date): Promise<boolean> {
    return withSystem(
      this.system,
      async (tx) =>
        (
          await tx
            .update(t)
            .set({ status: 'failed', errorCode, finishedAt: at, leaseUntil: null })
            .where(held(id, attempt))
            .returning({ id: t.id })
        ).length === 1,
    );
  }

  expireDue(now: Date, limit: number): Promise<DataExportRecord[]> {
    return withSystem(this.system, async (tx) => {
      const due = await tx
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.status, 'ready'), lt(t.expiresAt, now)))
        .limit(limit);
      if (due.length === 0) return [];
      const rows = await tx
        .update(t)
        .set({ status: 'expired', downloadTokenHash: null, downloadTokenExpiresAt: null })
        .where(
          inArray(
            t.id,
            due.map((d) => d.id),
          ),
        )
        .returning();
      return rows.map(toRecord);
    });
  }

  consumeLink(tokenHash: string, now: Date): Promise<DataExportRecord | null> {
    return withSystem(this.system, async (tx) => {
      // Read the link before clearing it (RETURNING would give the cleared expiry), locked so two
      // requests with the same token cannot both pass.
      const [r] = await tx.select().from(t).where(eq(t.downloadTokenHash, tokenHash)).for('update');
      if (!r) return null;
      await tx
        .update(t)
        .set({ downloadTokenHash: null, downloadTokenExpiresAt: null })
        .where(eq(t.id, r.id));
      const valid =
        r.status === 'ready' &&
        r.downloadTokenExpiresAt !== null &&
        r.downloadTokenExpiresAt > now &&
        (r.expiresAt === null || r.expiresAt > now);
      if (!valid) return null;
      await writeAudit(tx, {
        workspaceId: asWorkspaceId(r.workspaceId),
        actorUserId: r.requestedByUserId,
        actorName: r.requestedByName,
        action: 'workspace.data_export_downloaded',
        targetType: 'data_export',
        targetId: r.id,
      });
      return toRecord(r);
    });
  }
}
