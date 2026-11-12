import type { WorkspacePurgedV1 } from '@agent-sales/contracts';
import {
  and,
  asc,
  type Database,
  eq,
  lte,
  purgeWorkspaceRows,
  schema,
  sql,
  withSystem,
  writeAudit,
  writeSystemOutbox,
} from '@agent-sales/db';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';

import type { WorkspacePurgeStore } from '../../application/ports/workspace-purge.js';

/** The name a purged business keeps in its tombstone row (the real one is erased). */
export const TOMBSTONE_NAME = 'Deleted business';

/**
 * System-role purge (ADR-032, ADR-004 amendment 2026-11-12): only the purge runner of the worker
 * uses it, only for businesses whose owner deleted them more than 30 days ago.
 */
export class DrizzleWorkspacePurgeStore implements WorkspacePurgeStore {
  constructor(private readonly systemDb: Database) {}

  due(now: Date, limit: number): Promise<WorkspaceId[]> {
    return withSystem(this.systemDb, async (tx) => {
      const w = schema.workspaces;
      const rows = await tx
        .select({ id: w.id })
        .from(w)
        .where(and(eq(w.status, 'pending_deletion'), lte(w.purgeAfter, now)))
        .orderBy(asc(w.purgeAfter))
        .limit(limit);
      return rows.map((r) => workspaceId(r.id));
    });
  }

  stillDue(ws: WorkspaceId): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        select id from workspaces
        where id = ${ws} and status = 'pending_deletion' and purge_after <= now()
        for update`);
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
            logo_asset_id = null, profile_updated_by = null, icon = 'building'
        where id = ${ws} and status = 'pending_deletion' and purge_after <= now()
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
}

/** DB-less runs: nothing is ever due. */
export class NoopWorkspacePurgeStore implements WorkspacePurgeStore {
  async due(): Promise<WorkspaceId[]> {
    return [];
  }
  async stillDue(): Promise<boolean> {
    return false;
  }
  async purgeRows(): Promise<Record<string, number>> {
    return {};
  }
  async finish(): Promise<boolean> {
    return false;
  }
}
