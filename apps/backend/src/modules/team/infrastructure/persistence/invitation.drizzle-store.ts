import {
  and,
  type Database,
  desc,
  eq,
  isNull,
  schema,
  withSystem,
  withTenant,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
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

  insert(ws: WorkspaceId, i: InvitationRecord) {
    return withTenant(this.tenantDb, ws, async (tx) => {
      await tx.insert(t).values({ ...i, workspaceId: ws });
    });
  }

  revokePending(ws: WorkspaceId, email: string) {
    return withTenant(this.tenantDb, ws, async (tx) => {
      await tx
        .update(t)
        .set({ revokedAt: new Date() })
        .where(and(eq(t.email, email), isNull(t.acceptedAt), isNull(t.revokedAt)));
    });
  }

  revoke(ws: WorkspaceId, id: string) {
    return withTenant(this.tenantDb, ws, async (tx) => {
      await tx
        .update(t)
        .set({ revokedAt: new Date() })
        .where(and(eq(t.id, id), isNull(t.acceptedAt), isNull(t.revokedAt)));
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
