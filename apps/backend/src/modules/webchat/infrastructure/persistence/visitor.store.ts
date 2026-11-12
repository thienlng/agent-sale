import { and, eq, isNull, schema, sql, withTenant, type Database } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  VisitorMessageContext,
  VisitorRecord,
  VisitorStore,
} from '../../application/ports/visitor-store.js';

const v = schema.webchatVisitors;

function record(r: typeof v.$inferSelect): VisitorRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId as WorkspaceId,
    connectionId: r.connectionId,
    conversationId: r.conversationId,
    firstUrl: r.firstUrl,
    referrer: r.referrer,
    lastUrl: r.lastUrl,
    lastTitle: r.lastTitle,
    phoneE164: r.phoneE164,
    email: r.email,
    contactId: r.contactId,
    messageCount: r.messageCount,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  };
}

export class DrizzleVisitorStore implements VisitorStore {
  constructor(private readonly db: Database) {}

  recordMessage(
    ws: WorkspaceId,
    connectionId: string,
    visitorId: string,
    context: VisitorMessageContext,
  ): Promise<void> {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .insert(v)
        .values({
          id: visitorId,
          workspaceId: ws,
          connectionId,
          firstUrl: context.firstUrl,
          referrer: context.referrer,
          lastUrl: context.lastUrl,
          lastTitle: context.lastTitle,
        })
        .onConflictDoUpdate({
          target: v.id,
          set: { lastUrl: context.lastUrl, lastTitle: context.lastTitle, lastSeenAt: sql`now()` },
          // A token is signed per site, but never let a row of another connection be rewritten.
          setWhere: sql`${v.workspaceId} = ${ws} and ${v.connectionId} = ${connectionId}`,
        });
    });
  }

  find(ws: WorkspaceId, connectionId: string, visitorId: string) {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select()
        .from(v)
        .where(and(eq(v.workspaceId, ws), eq(v.connectionId, connectionId), eq(v.id, visitorId)));
      return r ? record(r) : null;
    });
  }

  countMessage(ws: WorkspaceId, connectionId: string, visitorId: string) {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(v)
        .set({ messageCount: sql`${v.messageCount} + 1` })
        .where(and(eq(v.workspaceId, ws), eq(v.connectionId, connectionId), eq(v.id, visitorId)));
    });
  }

  recordPhone(
    ws: WorkspaceId,
    connectionId: string,
    visitorId: string,
    phoneE164: string,
    contactId: string,
  ) {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(v)
        .set({ phoneE164, contactId, phoneCapturedAt: sql`now()` })
        .where(and(eq(v.workspaceId, ws), eq(v.connectionId, connectionId), eq(v.id, visitorId)));
    });
  }

  recordEmail(
    ws: WorkspaceId,
    connectionId: string,
    visitorId: string,
    email: string,
    contactId: string,
  ) {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(v)
        .set({ email, contactId, emailCapturedAt: sql`now()` })
        .where(and(eq(v.workspaceId, ws), eq(v.connectionId, connectionId), eq(v.id, visitorId)));
    });
  }

  linkConversation(
    ws: WorkspaceId,
    connectionId: string,
    visitorId: string,
    conversationId: string,
  ) {
    return withTenant(this.db, ws, async (tx) => {
      await tx
        .update(v)
        .set({ conversationId })
        .where(
          and(
            eq(v.workspaceId, ws),
            eq(v.connectionId, connectionId),
            eq(v.id, visitorId),
            isNull(v.conversationId),
          ),
        );
    });
  }

  forget(ws: WorkspaceId, contactId: string, conversationIds: readonly string[]) {
    return withTenant(this.db, ws, async (tx) => {
      const ids = sql`${`{${conversationIds.join(',')}}`}::uuid[]`;
      const rows = await tx
        .delete(v)
        .where(
          and(
            eq(v.workspaceId, ws),
            sql`(${v.contactId} = ${contactId} or ${v.conversationId} = any(${ids}))`,
          ),
        )
        .returning({ id: v.id });
      return rows.length;
    });
  }
}

export class UnavailableVisitorStore implements VisitorStore {
  forget(): Promise<number> {
    return Promise.resolve(0);
  }
  recordMessage(): Promise<void> {
    return Promise.reject(new Error('Website chat requires a configured database'));
  }
  find(): Promise<null> {
    return Promise.resolve(null);
  }
  countMessage(): Promise<void> {
    return Promise.resolve();
  }
  recordPhone(): Promise<void> {
    return Promise.resolve();
  }
  recordEmail(): Promise<void> {
    return Promise.resolve();
  }
  linkConversation(): Promise<void> {
    return Promise.resolve();
  }
}
