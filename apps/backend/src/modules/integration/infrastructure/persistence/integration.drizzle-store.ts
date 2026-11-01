import {
  and,
  desc,
  eq,
  isNull,
  lt,
  or,
  schema,
  sql,
  withSystem,
  withTenant,
  type Database,
} from '@agent-sales/db';
import { newId, type WorkspaceId } from '@agent-sales/shared';

import type {
  ClaimedWebhookEvent,
  ConnectionRecord,
  IntegrationProvider,
  IntegrationStore,
  JobRecord,
  SyncJobKind,
  SyncLogLevel,
} from '../../application/ports/integration-store.js';
import {
  ConnectionExistsError,
  ConnectionNotFoundError,
  ConnectionVersionConflictError,
} from '../../domain/integration.errors.js';

const c = schema.integrationConnections,
  j = schema.integrationJobs,
  log = schema.integrationSyncLog,
  img = schema.integrationImageCache;

/** Entries kept per connection in `integration_sync_log` (spec §4.3). */
const LOG_KEEP = 200;
/** Kinds this PR runs; `push_order` / `customer_import` stay queued until their runners land. */
const RUNNABLE_KINDS = sql.raw(`'full_import','reconcile','webhook'`);

type ConnectionRow = typeof c.$inferSelect;

function toConnection(r: ConnectionRow): ConnectionRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId as WorkspaceId,
    provider: r.provider,
    status: r.status,
    retailer: r.retailer,
    clientId: r.clientId,
    clientSecretSealed: r.clientSecretSealed,
    webhookToken: r.webhookToken,
    webhookSecretSealed: r.webhookSecretSealed,
    settings: r.settings as unknown as ConnectionRecord['settings'],
    version: r.version,
    progress: (r.progress ?? null) as ConnectionRecord['progress'],
    counts: (r.counts ?? {}) as ConnectionRecord['counts'],
    lastError: (r.lastError ?? null) as ConnectionRecord['lastError'],
    lastFullSyncAt: r.lastFullSyncAt,
    lastReconcileAt: r.lastReconcileAt,
    connectedByUserId: r.connectedByUserId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Columns a patch may write; identity, version and timestamps are owned by the store. */
function patchColumns(patch: Partial<ConnectionRecord>): Partial<typeof c.$inferInsert> {
  const set: Partial<typeof c.$inferInsert> = {};
  if (patch.status !== undefined) {
    set.status = patch.status;
    set.disconnectedAt = patch.status === 'disconnected' ? new Date() : null;
  }
  if (patch.retailer !== undefined) set.retailer = patch.retailer;
  if (patch.clientId !== undefined) set.clientId = patch.clientId;
  if (patch.clientSecretSealed !== undefined) set.clientSecretSealed = patch.clientSecretSealed;
  if (patch.webhookToken !== undefined) set.webhookToken = patch.webhookToken;
  if (patch.webhookSecretSealed !== undefined) set.webhookSecretSealed = patch.webhookSecretSealed;
  if (patch.settings !== undefined) set.settings = { ...patch.settings };
  if (patch.progress !== undefined) set.progress = patch.progress;
  if (patch.counts !== undefined) set.counts = { ...patch.counts };
  if (patch.lastError !== undefined) set.lastError = patch.lastError;
  if (patch.lastFullSyncAt !== undefined) set.lastFullSyncAt = patch.lastFullSyncAt;
  if (patch.lastReconcileAt !== undefined) set.lastReconcileAt = patch.lastReconcileAt;
  if (patch.connectedByUserId !== undefined) set.connectedByUserId = patch.connectedByUserId;
  return set;
}

/** Owner-driven fields: changing one bumps `version`; runner writes do not. */
const OWNER_FIELDS = ['settings', 'retailer', 'clientId', 'clientSecretSealed'] as const;
const ownerEdit = (patch: Partial<ConnectionRecord>): boolean =>
  OWNER_FIELDS.some((k) => patch[k] !== undefined);

function uniqueViolation(e: unknown, constraint: string): boolean {
  const err = e as { code?: string; constraint_name?: string; cause?: unknown };
  const cause = (err.cause ?? err) as { code?: string; constraint_name?: string };
  return cause.code === '23505' && cause.constraint_name === constraint;
}

/**
 * Postgres adapter of `IntegrationStore`. Tenant calls run under row-level security
 * (`withTenant`); the worker's cross-tenant claims use the system role (`withSystem`).
 */
export class DrizzleIntegrationStore implements IntegrationStore {
  constructor(
    private readonly db: Database,
    private readonly system: Database,
  ) {}

  liveConnection(ws: WorkspaceId, provider: IntegrationProvider) {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select()
        .from(c)
        .where(
          and(eq(c.workspaceId, ws), eq(c.provider, provider), sql`${c.status} <> 'disconnected'`),
        )
        .limit(1);
      return r ? toConnection(r) : null;
    });
  }

  async insertConnection(ws: WorkspaceId, rec: ConnectionRecord) {
    try {
      await withTenant(this.db, ws, async (tx) => {
        await tx.insert(c).values({
          id: rec.id,
          workspaceId: ws,
          provider: rec.provider,
          status: rec.status,
          retailer: rec.retailer,
          clientId: rec.clientId,
          clientSecretSealed: rec.clientSecretSealed,
          webhookToken: rec.webhookToken,
          webhookSecretSealed: rec.webhookSecretSealed,
          settings: { ...rec.settings },
          version: rec.version,
          progress: rec.progress,
          counts: { ...rec.counts },
          lastError: rec.lastError,
          lastFullSyncAt: rec.lastFullSyncAt,
          lastReconcileAt: rec.lastReconcileAt,
          connectedByUserId: rec.connectedByUserId,
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt,
        });
      });
    } catch (e) {
      if (uniqueViolation(e, 'integration_connections_live'))
        throw new ConnectionExistsError(rec.provider);
      throw e;
    }
  }

  updateConnection(
    ws: WorkspaceId,
    id: string,
    patch: Partial<ConnectionRecord>,
    expectedVersion?: number,
  ) {
    return withTenant(this.db, ws, async (tx) => {
      const scope = and(eq(c.workspaceId, ws), eq(c.id, id));
      const [r] = await tx
        .update(c)
        .set({
          ...patchColumns(patch),
          ...(ownerEdit(patch) ? { version: sql`${c.version} + 1` } : {}),
          updatedAt: new Date(),
        })
        .where(expectedVersion === undefined ? scope : and(scope, eq(c.version, expectedVersion)))
        .returning();
      if (r) return toConnection(r);
      const [exists] = await tx.select({ id: c.id }).from(c).where(scope);
      if (exists) throw new ConnectionVersionConflictError();
      throw new ConnectionNotFoundError('kiotviet');
    });
  }

  enqueue(
    ws: WorkspaceId,
    job: {
      connectionId: string;
      kind: SyncJobKind;
      payload?: Record<string, unknown>;
      runAfter?: Date;
    },
  ) {
    return withTenant(this.db, ws, async (tx) => {
      // The only unique key a fresh id can hit is `integration_jobs_one_sync`.
      const rows = await tx
        .insert(j)
        .values({
          id: newId(),
          workspaceId: ws,
          connectionId: job.connectionId,
          kind: job.kind,
          payload: job.payload ?? {},
          ...(job.runAfter ? { runAfter: job.runAfter } : {}),
        })
        .onConflictDoNothing()
        .returning({ id: j.id });
      return rows.length > 0;
    });
  }

  async log(
    ws: WorkspaceId,
    connectionId: string,
    e: { level: SyncLogLevel; code: string; params?: Record<string, string | number> },
  ) {
    await withTenant(this.db, ws, async (tx) => {
      await tx.insert(log).values({
        id: newId(),
        workspaceId: ws,
        connectionId,
        level: e.level,
        code: e.code,
        params: e.params ?? {},
      });
      await tx.execute(sql`
        delete from integration_sync_log
        where connection_id = ${connectionId}
          and id not in (
            select id from integration_sync_log where connection_id = ${connectionId}
            order by at desc, id desc limit ${LOG_KEEP})`);
    });
  }

  recentLog(ws: WorkspaceId, connectionId: string, limit: number) {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select()
          .from(log)
          .where(and(eq(log.workspaceId, ws), eq(log.connectionId, connectionId)))
          .orderBy(desc(log.at), desc(log.id))
          .limit(limit)
      ).map((r) => ({
        id: r.id,
        level: r.level,
        code: r.code,
        params: r.params as Record<string, string | number>,
        at: r.at,
      })),
    );
  }

  cachedImage(ws: WorkspaceId, sourceUrl: string) {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select({ storedUrl: img.storedUrl })
        .from(img)
        .where(and(eq(img.workspaceId, ws), eq(img.sourceUrl, sourceUrl)));
      return r?.storedUrl ?? null;
    });
  }

  async cacheImage(ws: WorkspaceId, sourceUrl: string, storedUrl: string) {
    await withTenant(this.db, ws, async (tx) => {
      await tx
        .insert(img)
        .values({ workspaceId: ws, sourceUrl, storedUrl })
        .onConflictDoUpdate({ target: [img.workspaceId, img.sourceUrl], set: { storedUrl } });
    });
  }

  claimJobs(limit: number, leaseMs: number) {
    return withSystem(this.system, async (tx) => {
      // A disconnected connection's queue is dead: close its idle jobs rather than run them. A job a
      // runner still holds is left to that runner, which sees the status itself.
      await tx.execute(sql`
        update integration_jobs j set done_at = now(), last_error = 'connection_disconnected'
        from integration_connections c
        where c.id = j.connection_id and c.status = 'disconnected'
          and j.done_at is null and j.failed_at is null
          and (j.lease_until is null or j.lease_until < now())`);
      const rows = await tx.execute<{
        id: string;
        workspace_id: string;
        connection_id: string;
        kind: SyncJobKind;
        payload: Record<string, unknown>;
        cursor: Record<string, unknown> | null;
        attempts: number;
        claim_token: string;
      }>(sql`
        with picked as (
          select j.id from integration_jobs j
          where j.done_at is null and j.failed_at is null
            and j.kind in (${RUNNABLE_KINDS})
            and j.run_after <= now()
            and (j.lease_until is null or j.lease_until < now())
            and exists (select 1 from integration_connections c
                        where c.id = j.connection_id and c.status <> 'disconnected')
          order by j.run_after
          limit ${limit}
          for update skip locked)
        update integration_jobs j
        set lease_until = now() + ${leaseMs}::int * interval '1 millisecond',
            claim_token = gen_random_uuid(),
            attempts = j.attempts + 1
        from picked where j.id = picked.id
        returning j.id, j.workspace_id, j.connection_id, j.kind, j.payload, j.cursor, j.attempts,
                  j.claim_token`);
      return [...rows].map((r): JobRecord => ({
        id: r.id,
        workspaceId: r.workspace_id as WorkspaceId,
        connectionId: r.connection_id,
        kind: r.kind,
        payload: r.payload ?? {},
        cursor: r.cursor ?? null,
        attempts: r.attempts,
        claimToken: r.claim_token,
      }));
    });
  }

  /** The claim token fences ownership: a re-claimed job ignores its previous holder. */
  private fenced(jobId: string, claimToken: string) {
    return and(
      eq(j.id, jobId),
      eq(j.claimToken, claimToken),
      sql`${j.doneAt} is null and ${j.failedAt} is null`,
    );
  }

  async saveCursor(
    jobId: string,
    claimToken: string,
    cursor: Record<string, unknown>,
    leaseMs: number,
  ) {
    return this.fencedUpdate(jobId, claimToken, {
      cursor,
      leaseUntil: sql`now() + ${leaseMs}::int * interval '1 millisecond'`,
    });
  }

  completeJob(jobId: string, claimToken: string) {
    return this.fencedUpdate(jobId, claimToken, { doneAt: new Date(), leaseUntil: null });
  }

  retryJob(jobId: string, claimToken: string, runAfter: Date, error: string) {
    return this.fencedUpdate(jobId, claimToken, { runAfter, leaseUntil: null, lastError: error });
  }

  failJob(jobId: string, claimToken: string, error: string) {
    return this.fencedUpdate(jobId, claimToken, {
      failedAt: new Date(),
      leaseUntil: null,
      lastError: error,
    });
  }

  /** True when the claim token still owned the open job and the write applied. */
  private fencedUpdate(
    jobId: string,
    claimToken: string,
    set: Partial<Record<keyof typeof j.$inferInsert, unknown>>,
  ): Promise<boolean> {
    return withSystem(this.system, async (tx) => {
      const rows = await tx
        .update(j)
        .set(set as Partial<typeof j.$inferInsert>)
        .where(this.fenced(jobId, claimToken))
        .returning({ id: j.id });
      return rows.length > 0;
    });
  }

  claimWebhookEvents(limit: number) {
    return withSystem(this.system, async (tx) => {
      const rows = await tx.execute<{
        id: string;
        workspace_id: string;
        connection_id: string;
        body: string;
        signature: string | null;
      }>(sql`
        with picked as (
          select id from integration_webhook_events
          where processed_at is null
          order by received_at
          limit ${limit}
          for update skip locked),
        taken as (
          update integration_webhook_events e set processed_at = now()
          from picked where e.id = picked.id
          returning e.id, e.workspace_id, e.connection_id, e.body, e.signature, e.received_at)
        select t.id, t.workspace_id, t.connection_id, t.body, t.signature
        from taken t join integration_connections c on c.id = t.connection_id
        where c.status <> 'disconnected'
        order by t.received_at`);
      return [...rows].map((r): ClaimedWebhookEvent => ({
        id: r.id,
        workspaceId: r.workspace_id as WorkspaceId,
        connectionId: r.connection_id,
        body: r.body,
        signature: r.signature,
      }));
    });
  }

  connectionsDueForReconcile(olderThan: Date) {
    return withSystem(this.system, async (tx) =>
      (
        await tx
          .select({ workspaceId: c.workspaceId, connectionId: c.id })
          .from(c)
          .where(
            and(
              sql`${c.status} in ('connected','error')`,
              or(isNull(c.lastReconcileAt), lt(c.lastReconcileAt, olderThan)),
            ),
          )
      ).map((r) => ({ workspaceId: r.workspaceId as WorkspaceId, connectionId: r.connectionId })),
    );
  }

  connectionForSystem(id: string) {
    return withSystem(this.system, async (tx) => {
      const [r] = await tx.select().from(c).where(eq(c.id, id));
      return r ? toConnection(r) : null;
    });
  }
}
