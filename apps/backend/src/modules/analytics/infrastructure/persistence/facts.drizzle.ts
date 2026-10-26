import { type Database, schema, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { FactStore } from '../../domain/ports/projection.js';

const CHUNK = 500;

/** Appends facts under tenant RLS; the unique (workspace, event, kind) key makes replays no-ops. */
export class DrizzleFactStore implements FactStore {
  constructor(private readonly db: Database) {}

  append(ws: WorkspaceId, facts: Parameters<FactStore['append']>[1]): Promise<number> {
    if (!facts.length) return Promise.resolve(0);
    return withTenant(this.db, ws, async (tx) => {
      let added = 0;
      for (let i = 0; i < facts.length; i += CHUNK) {
        const rows = await tx
          .insert(schema.analyticsFacts)
          .values(facts.slice(i, i + CHUNK).map((f) => ({ ...f })))
          .onConflictDoNothing()
          .returning({ id: schema.analyticsFacts.id });
        added += rows.length;
      }
      return added;
    });
  }
}
