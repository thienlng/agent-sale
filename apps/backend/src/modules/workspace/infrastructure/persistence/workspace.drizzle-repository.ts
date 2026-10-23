import { type Database, eq, schema, withTenant } from '@agent-sales/db';
import { userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';

import type { WorkspaceRepository } from '../../domain/ports/workspace.repository.js';
import { Workspace } from '../../domain/workspace.js';

/**
 * Drizzle adapter. Every query runs inside withTenant() (ADR-004): the RLS
 * context is the workspace being read/written. Wired into DI by T-004.
 */
export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: Database) {}

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    return withTenant(this.db, id, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, id))
        .limit(1);
      if (!row) return null;
      return Workspace.rehydrate({
        id: workspaceId(row.id),
        name: row.name,
        industry: row.industry,
        timezone: row.timezone,
        ownerUserId: userId(row.ownerUserId),
        status: row.status as 'active' | 'suspended' | 'deleted',
        createdAt: row.createdAt,
      });
    });
  }

  async save(workspace: Workspace): Promise<void> {
    const s = workspace.snapshot();
    await withTenant(this.db, s.id, async (tx) => {
      await tx
        .insert(schema.workspaces)
        .values({
          id: s.id,
          workspaceId: s.id,
          name: s.name,
          industry: s.industry,
          timezone: s.timezone,
          ownerUserId: s.ownerUserId,
          status: s.status,
          createdAt: s.createdAt,
        })
        .onConflictDoUpdate({
          target: schema.workspaces.id,
          set: {
            name: s.name,
            industry: s.industry,
            timezone: s.timezone,
            status: s.status,
            updatedAt: new Date(),
          },
        });
    });
  }
}
