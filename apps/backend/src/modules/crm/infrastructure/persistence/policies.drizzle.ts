import { and, eq, schema, sql, type TenantTx } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { CrmTx, PolicyRecord } from '../../application/ports/crm-store.js';

const p = schema.crmAssignmentPolicies;

const toPolicy = (r: typeof p.$inferSelect): PolicyRecord => ({
  sourceId: r.sourceId,
  enabled: r.enabled,
  candidates: r.candidates,
  cursor: r.cursor,
  version: r.version,
});

/** Auto-assignment policies inside one tenant transaction. */
export function policiesTx(ws: WorkspaceId, tx: TenantTx): Pick<CrmTx, 'policies'> {
  return {
    policies: {
      async list() {
        return (await tx.select().from(p)).map(toPolicy);
      },
      async find(sourceId, opts) {
        const q = tx.select().from(p).where(eq(p.sourceId, sourceId)).limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toPolicy(r) : null;
      },
      async save(rec, expectedVersion) {
        const values = { enabled: rec.enabled, candidates: rec.candidates };
        if (expectedVersion === 0) {
          const rows = await tx
            .insert(p)
            .values({ workspaceId: ws, sourceId: rec.sourceId, ...values, version: 1 })
            .onConflictDoNothing()
            .returning({ version: p.version });
          return rows[0]?.version ?? null;
        }
        const rows = await tx
          .update(p)
          .set({ ...values, version: sql`${p.version} + 1`, updatedAt: new Date() })
          .where(and(eq(p.sourceId, rec.sourceId), eq(p.version, expectedVersion)))
          .returning({ version: p.version });
        return rows[0]?.version ?? null;
      },
      async advance(sourceId) {
        await tx
          .update(p)
          .set({ cursor: sql`${p.cursor} + 1` })
          .where(eq(p.sourceId, sourceId));
      },
    },
  };
}
