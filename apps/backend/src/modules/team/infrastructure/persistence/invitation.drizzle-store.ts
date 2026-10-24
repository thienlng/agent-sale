import {
  and,
  type Database,
  desc,
  eq,
  isNull,
  schema,
  sql,
  withSystem,
  withTenant,
  writeAudit,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  InvitationAudit,
  InvitationRecord,
  InvitationStore,
} from '../../application/ports/invitation-store.js';

const t = schema.invitations;
const toRecord = (r: typeof t.$inferSelect): InvitationRecord => ({
  ...r,
  role: r.role as InvitationRecord['role'],
});

/** Workspace screens use the tenant role (RLS); link lookups use the system role. */
export class DrizzleInvitationStore implements InvitationStore {
  constructor(
    private readonly tenantDb: Database,
    private readonly systemDb: Database,
  ) {}

  list(ws: WorkspaceId) {
    return withTenant(this.tenantDb, ws, async (tx) =>
      (await tx.select().from(t).orderBy(desc(t.createdAt)).limit(200)).map(toRecord),
    );
  }

  find(ws: WorkspaceId, id: string) {
    return withTenant(this.tenantDb, ws, async (tx) => {
      const [r] = await tx.select().from(t).where(eq(t.id, id)).limit(1);
      return r ? toRecord(r) : null;
    });
  }

  countPending(ws: WorkspaceId, exceptEmail: string) {
    return withTenant(this.tenantDb, ws, async (tx) => {
      const [r] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(t)
        .where(
          and(
            isNull(t.acceptedAt),
            isNull(t.revokedAt),
            sql`${t.expiresAt} > now()`,
            sql`${t.email} <> ${exceptEmail}`,
          ),
        );
      return Number(r?.n ?? 0);
    });
  }

  replacePending(ws: WorkspaceId, i: InvitationRecord, audit: InvitationAudit) {
    return withTenant(this.tenantDb, ws, async (tx) => {
      await tx
        .update(t)
        .set({ revokedAt: new Date() })
        .where(and(eq(t.email, i.email), isNull(t.acceptedAt), isNull(t.revokedAt)));
      // A concurrent re-invite loses on the pending-unique index instead of leaving two links.
      await tx.insert(t).values({ ...i, workspaceId: ws });
      await writeAudit(tx, {
        workspaceId: ws,
        actorUserId: audit.actorUserId,
        actorName: audit.actorName,
        action: audit.action,
        targetType: 'invitation',
        targetId: i.id,
        data: { role: i.role, ...audit.data },
      });
    });
  }

  revoke(ws: WorkspaceId, id: string, audit: InvitationAudit) {
    return withTenant(this.tenantDb, ws, async (tx) => {
      const revoked = await tx
        .update(t)
        .set({ revokedAt: new Date() })
        .where(and(eq(t.id, id), isNull(t.acceptedAt), isNull(t.revokedAt)))
        .returning({ role: t.role });
      if (revoked[0]) {
        await writeAudit(tx, {
          workspaceId: ws,
          actorUserId: audit.actorUserId,
          actorName: audit.actorName,
          action: audit.action,
          targetType: 'invitation',
          targetId: id,
          data: { role: revoked[0].role, ...audit.data },
        });
      }
      const [r] = await tx.select().from(t).where(eq(t.id, id)).limit(1);
      return r ? toRecord(r) : null;
    });
  }

  findByTokenHash(hash: string) {
    return withSystem(this.systemDb, async (tx) => {
      const [r] = await tx.select().from(t).where(eq(t.tokenHash, hash)).limit(1);
      return r ? toRecord(r) : null;
    });
  }

  releaseAccepted(id: string, userId: string) {
    return withSystem(this.systemDb, async (tx) => {
      await tx
        .update(t)
        .set({ acceptedAt: null, acceptedByUserId: null })
        .where(and(eq(t.id, id), eq(t.acceptedByUserId, userId)));
    });
  }

  markAccepted(id: string, userId: string, at: Date) {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .update(t)
        .set({ acceptedAt: at, acceptedByUserId: userId })
        .where(and(eq(t.id, id), isNull(t.acceptedAt), isNull(t.revokedAt)))
        .returning({ id: t.id });
      return rows.length === 1;
    });
  }
}
