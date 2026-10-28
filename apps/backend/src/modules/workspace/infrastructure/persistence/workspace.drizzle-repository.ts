import { and, eq, schema, sql, type TenantTx } from '@agent-sales/db';
import { userId, workspaceId, type UserId, type WorkspaceId } from '@agent-sales/shared';

import type { MemberRepository, Membership } from '../../domain/ports/member.repository.js';
import type { WorkspaceRepository } from '../../domain/ports/workspace.repository.js';
import { Workspace } from '../../domain/workspace.js';

/**
 * Drizzle adapters bound to one tenant transaction (created by the unit of
 * work inside withTenant). They never open their own transactions.
 */
export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly tx: TenantTx) {}

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    const [row] = await this.tx
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
      accountId: row.accountId,
      status: row.status as 'active' | 'suspended' | 'deleted',
      createdAt: row.createdAt,
    });
  }

  async save(workspace: Workspace): Promise<void> {
    const s = workspace.snapshot();
    await this.tx
      .insert(schema.workspaces)
      .values({
        id: s.id,
        workspaceId: s.id,
        name: s.name,
        industry: s.industry,
        timezone: s.timezone,
        ownerUserId: s.ownerUserId,
        accountId: s.accountId,
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
  }
}

export class DrizzleMemberRepository implements MemberRepository {
  constructor(private readonly tx: TenantTx) {}

  async add(m: Membership): Promise<void> {
    await this.tx.insert(schema.members).values({
      id: m.id,
      workspaceId: m.workspaceId,
      userId: m.userId,
      role: m.role,
      status: m.status,
    });
  }

  async lockSeats(ws: WorkspaceId): Promise<void> {
    await this.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ws}::text, 7))`);
  }

  async countActive(ws: WorkspaceId): Promise<number> {
    const [r] = await this.tx
      .select({ n: sql<number>`count(*)` })
      .from(schema.members)
      .where(and(eq(schema.members.workspaceId, ws), eq(schema.members.status, 'active')));
    return Number(r?.n ?? 0);
  }

  async update(m: Membership): Promise<void> {
    await this.tx
      .update(schema.members)
      .set({
        role: m.role,
        status: m.status,
        removedAt: m.status === 'removed' ? new Date() : null,
      })
      .where(eq(schema.members.id, m.id));
  }

  async find(ws: WorkspaceId, user: UserId): Promise<Membership | null> {
    const [row] = await this.tx
      .select()
      .from(schema.members)
      .where(and(eq(schema.members.workspaceId, ws), eq(schema.members.userId, user)))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: workspaceId(row.workspaceId),
      userId: userId(row.userId),
      role: row.role as Membership['role'],
      status: row.status as Membership['status'],
    };
  }
}
