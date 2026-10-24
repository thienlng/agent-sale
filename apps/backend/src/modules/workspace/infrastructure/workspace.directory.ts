import { and, type Database, eq, isNull, schema, withSystem } from '@agent-sales/db';
import { type UserId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';

import type { WorkspaceMember, WorkspaceMembership } from '../api/workspace.facade.js';
import type { WorkspaceDirectory } from '../application/ports/workspace-directory.js';
import type { InMemoryWorkspaceUnitOfWork } from './workspace.unit-of-work.js';

/** System-role lookups (membership checks happen before any tenant context exists). */
export class DrizzleWorkspaceDirectory implements WorkspaceDirectory {
  constructor(private readonly systemDb: Database) {}

  async findMembership(ws: WorkspaceId, user: UserId): Promise<WorkspaceMembership | null> {
    const rows = await this.query(user, ws);
    return rows[0] ?? null;
  }

  listMemberships(user: UserId): Promise<WorkspaceMembership[]> {
    return this.query(user);
  }

  listMembers(ws: WorkspaceId): Promise<WorkspaceMember[]> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select({ userId: schema.members.userId, role: schema.members.role })
        .from(schema.members)
        .where(and(eq(schema.members.workspaceId, ws), eq(schema.members.status, 'active')))
        .orderBy(schema.members.createdAt);
      return rows.map((r) => ({ userId: userId(r.userId), role: r.role }));
    });
  }

  private query(user: UserId, ws?: WorkspaceId): Promise<WorkspaceMembership[]> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select({
          workspaceId: schema.workspaces.id,
          workspaceName: schema.workspaces.name,
          role: schema.members.role,
        })
        .from(schema.members)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.members.workspaceId))
        .where(
          and(
            eq(schema.members.userId, user),
            eq(schema.members.status, 'active'),
            isNull(schema.workspaces.deletedAt),
            ws ? eq(schema.members.workspaceId, ws) : undefined,
          ),
        );
      return rows.map((r) => ({ ...r, workspaceId: workspaceId(r.workspaceId) }));
    });
  }
}

/** Reads the same in-memory store as InMemoryWorkspaceUnitOfWork (DB-less runs and tests). */
export class InMemoryWorkspaceDirectory implements WorkspaceDirectory {
  constructor(private readonly store: InMemoryWorkspaceUnitOfWork) {}

  async findMembership(ws: WorkspaceId, user: UserId): Promise<WorkspaceMembership | null> {
    return (await this.listMemberships(user)).find((m) => m.workspaceId === ws) ?? null;
  }

  async listMembers(ws: WorkspaceId): Promise<WorkspaceMember[]> {
    return this.store.members.rows
      .filter((m) => m.workspaceId === ws && m.status === 'active')
      .map((m) => ({ userId: m.userId, role: m.role }));
  }

  async listMemberships(user: UserId): Promise<WorkspaceMembership[]> {
    const out: WorkspaceMembership[] = [];
    for (const m of this.store.members.rows) {
      if (m.userId !== user || m.status !== 'active') continue;
      const w = await this.store.workspaces.findById(m.workspaceId);
      if (w)
        out.push({ workspaceId: m.workspaceId, workspaceName: w.snapshot().name, role: m.role });
    }
    return out;
  }
}
