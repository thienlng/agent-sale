import type { WorkspacePurgedV1 } from '@agent-sales/contracts';
import {
  type Database,
  purgeWorkspaceRows,
  sql,
  withSystem,
  writeAudit,
  writeSystemOutbox,
} from '@agent-sales/db';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';

import type { DuePurge, WorkspacePurgeStore } from '../../application/ports/workspace-purge.js';

/** The name a purged business keeps in its tombstone row (the real one is erased). */
export const TOMBSTONE_NAME = 'Deleted business';

/**
 * System-role purge (ADR-032, ADR-004 amendment 2026-11-12): only the purge runner of the worker
 * uses it, only for businesses whose owner deleted them more than 30 days ago.
 */
export class DrizzleWorkspacePurgeStore implements WorkspacePurgeStore {
  constructor(private readonly systemDb: Database) {}

  due(now: Date, limit: number): Promise<DuePurge[]> {
    const at = now.toISOString();
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx.execute<{ id: string; attempts: number }>(sql`
        select id, purge_attempts as attempts from workspaces
        where (status = 'purging'
            or (status = 'pending_deletion' and purge_after <= ${at}::timestamptz))
          and (purge_next_at is null or purge_next_at <= ${at}::timestamptz)
        order by coalesce(purge_next_at, purge_after), id
        limit ${limit}`);
      return rows.map((r) => ({ workspaceId: workspaceId(r.id), attempts: Number(r.attempts) }));
    });
  }

  claim(ws: WorkspaceId): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      // One statement, the database clock: a restore (`status = 'pending_deletion' and
      // purge_after > now()`) and this claim can never both match the row.
      const rows = await tx.execute<{ id: string }>(sql`
        update workspaces set status = 'purging', updated_at = now()
        where id = ${ws}
          and (status = 'purging' or (status = 'pending_deletion' and purge_after <= now()))
        returning id`);
      return rows.length > 0;
    });
  }

  purgeRows(ws: WorkspaceId): Promise<Record<string, number>> {
    return purgeWorkspaceRows(this.systemDb, ws);
  }

  finish(ws: WorkspaceId, rows: number): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const done = await tx.execute<{ id: string }>(sql`
        update workspaces
        set status = 'deleted', purged_at = now(), updated_at = now(), name = ${TOMBSTONE_NAME},
            company_name = '', business_services = '', product_description = '',
            logo_asset_id = null, profile_updated_by = null, icon = 'building',
            purge_attempts = 0, purge_next_at = null, purge_last_error = null
        where id = ${ws} and status = 'purging'
        returning id`);
      if (!done.length) return false;
      await writeAudit(tx, {
        workspaceId: ws,
        actorUserId: null,
        actorName: 'system',
        action: 'workspace.purged',
        targetType: 'workspace',
        targetId: ws,
        data: { rows },
      });
      const event: WorkspacePurgedV1 = {
        type: 'workspace.workspace.purged.v1',
        workspaceId: ws,
        occurredAt: new Date().toISOString(),
      };
      // A platform event (no workspace): the business's rows, its outbox ones included, are gone.
      await writeSystemOutbox(tx, {
        type: event.type,
        aggregateType: 'workspace',
        aggregateId: ws,
        payload: event,
      });
      return true;
    });
  }

  async recordFailure(ws: WorkspaceId, failure: { error: string; nextAt: Date }): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx.execute(sql`
        update workspaces
        set purge_attempts = purge_attempts + 1, purge_next_at = ${failure.nextAt.toISOString()}::timestamptz,
            purge_last_error = ${failure.error.slice(0, 120)}
        where id = ${ws} and status in ('pending_deletion', 'purging')`),
    );
  }
}

/** DB-less runs: nothing is ever due. */
export class NoopWorkspacePurgeStore implements WorkspacePurgeStore {
  async due(): Promise<DuePurge[]> {
    return [];
  }
  async claim(): Promise<boolean> {
    return false;
  }
  async purgeRows(): Promise<Record<string, number>> {
    return {};
  }
  async finish(): Promise<boolean> {
    return false;
  }
  async recordFailure(): Promise<void> {}
}
