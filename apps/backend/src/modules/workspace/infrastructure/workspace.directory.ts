import {
  and,
  asc,
  type Database,
  desc,
  eq,
  inArray,
  isNull,
  schema,
  sql,
  withSystem,
} from '@agent-sales/db';
import { type UserId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';

import type {
  AccountBusiness,
  WorkspaceMember,
  WorkspaceMembership,
} from '../api/workspace.facade.js';
import type {
  DeletedBusiness,
  DeletionTarget,
  WorkspaceDirectory,
} from '../application/ports/workspace-directory.js';
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

  listMembers(ws: WorkspaceId, includeRemoved: boolean): Promise<WorkspaceMember[]> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select({
          userId: schema.members.userId,
          role: schema.members.role,
          status: schema.members.status,
          joinedAt: schema.members.createdAt,
        })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.workspaceId, ws),
            includeRemoved ? undefined : eq(schema.members.status, 'active'),
          ),
        )
        .orderBy(schema.members.createdAt);
      return rows.map((r) => ({
        userId: userId(r.userId),
        role: r.role,
        status: r.status === 'active' ? ('active' as const) : ('removed' as const),
        joinedAt: r.joinedAt,
      }));
    });
  }

  listActiveIds(afterId: WorkspaceId | null, limit: number): Promise<WorkspaceId[]> {
    return withSystem(this.systemDb, async (tx) => {
      const w = schema.workspaces;
      const rows = await tx
        .select({ id: w.id })
        .from(w)
        .where(
          and(
            eq(w.status, 'active'),
            isNull(w.deletedAt),
            afterId ? sql`${w.id} > ${afterId}` : undefined,
          ),
        )
        .orderBy(asc(w.id))
        .limit(limit);
      return rows.map((r) => workspaceId(r.id));
    });
  }

  listByAccounts(accountIds: readonly string[]): Promise<AccountBusiness[]> {
    return withSystem(this.systemDb, async (tx) => {
      const w = schema.workspaces;
      const rows = await tx
        .select({
          workspaceId: w.id,
          accountId: w.accountId,
          name: w.name,
          industry: w.industry,
          status: w.status,
          createdAt: w.createdAt,
          memberCount: sql<number>`(select count(*)::int from ${schema.members} m
            where m.workspace_id = ${w.id} and m.status = 'active')`,
        })
        .from(w)
        .where(and(inArray(w.accountId, [...accountIds]), isNull(w.deletedAt)))
        .orderBy(asc(w.createdAt));
      return rows.map((r) => ({
        ...r,
        workspaceId: workspaceId(r.workspaceId),
        accountId: r.accountId ?? '',
      }));
    });
  }

  isActive(ws: WorkspaceId): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const w = schema.workspaces;
      const [row] = await tx
        .select({ id: w.id })
        .from(w)
        .where(and(eq(w.id, ws), eq(w.status, 'active'), isNull(w.deletedAt)))
        .limit(1);
      return row !== undefined;
    });
  }

  deletionTarget(ws: WorkspaceId, user: UserId): Promise<DeletionTarget | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx
        .select({ role: schema.members.role, status: schema.workspaces.status })
        .from(schema.members)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.members.workspaceId))
        .where(
          and(
            eq(schema.members.workspaceId, ws),
            eq(schema.members.userId, user),
            eq(schema.members.status, 'active'),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  listDeletedOwnedBy(user: UserId): Promise<DeletedBusiness[]> {
    return withSystem(this.systemDb, async (tx) => {
      const w = schema.workspaces;
      const rows = await tx
        .select({
          workspaceId: w.id,
          name: w.name,
          industry: w.industry,
          icon: w.icon,
          deletedAt: w.deletedAt,
          purgeAfter: w.purgeAfter,
        })
        .from(schema.members)
        .innerJoin(w, eq(w.id, schema.members.workspaceId))
        .where(
          and(
            eq(schema.members.userId, user),
            eq(schema.members.status, 'active'),
            eq(schema.members.role, 'owner'),
            eq(w.status, 'pending_deletion'),
          ),
        )
        .orderBy(desc(w.deletedAt));
      return rows.flatMap((r) =>
        r.deletedAt && r.purgeAfter
          ? [
              {
                ...r,
                workspaceId: workspaceId(r.workspaceId),
                deletedAt: r.deletedAt,
                purgeAfter: r.purgeAfter,
              },
            ]
          : [],
      );
    });
  }

  private query(user: UserId, ws?: WorkspaceId): Promise<WorkspaceMembership[]> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select({
          workspaceId: schema.workspaces.id,
          workspaceName: schema.workspaces.name,
          role: schema.members.role,
          icon: schema.workspaces.icon,
          logoSha256: sql<
            string | null
          >`(select ${schema.workspaceAssets.sha256} from ${schema.workspaceAssets} where ${schema.workspaceAssets.id} = ${schema.workspaces.logoAssetId})`,
          industry: schema.workspaces.industry,
          accountId: schema.workspaces.accountId,
          createdAt: schema.workspaces.createdAt,
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
      return rows.map(({ logoSha256, ...r }) => ({
        ...r,
        workspaceId: workspaceId(r.workspaceId),
        logoVersion: logoSha256?.slice(0, 16) ?? null,
      }));
    });
  }
}

/** Reads the same in-memory store as InMemoryWorkspaceUnitOfWork (DB-less runs and tests). */
export class InMemoryWorkspaceDirectory implements WorkspaceDirectory {
  constructor(private readonly store: InMemoryWorkspaceUnitOfWork) {}

  async findMembership(ws: WorkspaceId, user: UserId): Promise<WorkspaceMembership | null> {
    return (await this.listMemberships(user)).find((m) => m.workspaceId === ws) ?? null;
  }

  async listMembers(ws: WorkspaceId, includeRemoved: boolean): Promise<WorkspaceMember[]> {
    return this.store.members.rows
      .filter((m) => m.workspaceId === ws && (includeRemoved || m.status === 'active'))
      .map((m) => ({ userId: m.userId, role: m.role, status: m.status, joinedAt: new Date(0) }));
  }

  async listActiveIds(afterId: WorkspaceId | null, limit: number): Promise<WorkspaceId[]> {
    return this.store.workspaces
      .all()
      .map((w) => w.snapshot())
      .filter((s) => s.status === 'active' && (afterId === null || s.id > afterId))
      .map((s) => s.id)
      .sort()
      .slice(0, limit);
  }

  async listByAccounts(accountIds: readonly string[]): Promise<AccountBusiness[]> {
    return this.store.workspaces
      .all()
      .map((w) => w.snapshot())
      .filter((s) => s.accountId !== null && accountIds.includes(s.accountId) && !s.deletedAt)
      .map((s) => ({
        workspaceId: s.id,
        accountId: s.accountId ?? '',
        name: s.name,
        industry: s.industry,
        status: s.status,
        createdAt: s.createdAt,
        memberCount: this.store.members.rows.filter(
          (m) => m.workspaceId === s.id && m.status === 'active',
        ).length,
      }));
  }

  async isActive(ws: WorkspaceId): Promise<boolean> {
    const s = (await this.store.workspaces.findById(ws))?.snapshot();
    return s?.status === 'active' && !s.deletedAt;
  }

  async deletionTarget(ws: WorkspaceId, user: UserId): Promise<DeletionTarget | null> {
    const m = this.store.members.rows.find(
      (r) => r.workspaceId === ws && r.userId === user && r.status === 'active',
    );
    const s = (await this.store.workspaces.findById(ws))?.snapshot();
    return m && s ? { role: m.role, status: s.status } : null;
  }

  async listDeletedOwnedBy(user: UserId): Promise<DeletedBusiness[]> {
    const owned = new Set(
      this.store.members.rows
        .filter((m) => m.userId === user && m.status === 'active' && m.role === 'owner')
        .map((m) => m.workspaceId),
    );
    return this.store.workspaces
      .all()
      .map((w) => w.snapshot())
      .flatMap((s) =>
        owned.has(s.id) && s.status === 'pending_deletion' && s.deletedAt && s.purgeAfter
          ? [
              {
                workspaceId: s.id,
                name: s.name,
                industry: s.industry,
                icon: 'building',
                deletedAt: s.deletedAt,
                purgeAfter: s.purgeAfter,
              },
            ]
          : [],
      )
      .sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  }

  async listMemberships(user: UserId): Promise<WorkspaceMembership[]> {
    const out: WorkspaceMembership[] = [];
    for (const m of this.store.members.rows) {
      if (m.userId !== user || m.status !== 'active') continue;
      const w = await this.store.workspaces.findById(m.workspaceId);
      if (!w) continue;
      const s = w.snapshot();
      if (s.deletedAt) continue;
      out.push({
        workspaceId: m.workspaceId,
        workspaceName: s.name,
        role: m.role,
        industry: s.industry,
        accountId: s.accountId,
        createdAt: s.createdAt,
      });
    }
    return out;
  }
}
