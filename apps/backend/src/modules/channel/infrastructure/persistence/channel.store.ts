import { and, desc, eq, schema, sql, withSystem, withTenant, type Database } from '@agent-sales/db';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import type { MetaProvider } from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type {
  ChannelStore,
  ConnectionRecord,
  OAuthFlow,
  PendingMetaEvent,
} from '../../application/ports/channel-store.js';
import { ChannelError } from '../../domain/channel.errors.js';
import { MAX_EVENT_ATTEMPTS } from '../../api/channel.facade.js';
const c = schema.channelConnections,
  f = schema.channelOauthFlows,
  e = schema.channelWebhookEvents;
function connection(r: typeof c.$inferSelect): ConnectionRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId as WorkspaceId,
    provider: r.provider as MetaProvider,
    externalId: r.externalId,
    name: r.name,
    status: r.status as ConnectionRecord['status'],
    botId: r.botId,
    tokenSealed: r.tokenSealed,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
function flow(r: typeof f.$inferSelect): OAuthFlow {
  return { ...r, workspaceId: r.workspaceId as WorkspaceId, provider: r.provider as MetaProvider };
}
export class DrizzleChannelStore implements ChannelStore {
  constructor(
    private readonly db: Database,
    private readonly system: Database,
  ) {}
  list(ws: WorkspaceId) {
    return withTenant(this.db, ws, async (tx) =>
      (await tx.select().from(c).where(eq(c.workspaceId, ws)).orderBy(desc(c.createdAt))).map(
        connection,
      ),
    );
  }
  get(ws: WorkspaceId, id: string) {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select()
        .from(c)
        .where(and(eq(c.workspaceId, ws), eq(c.id, id)));
      return r ? connection(r) : null;
    });
  }
  update(ws: WorkspaceId, id: string, patch: Parameters<ChannelStore['update']>[2]) {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .update(c)
        .set(patch)
        .where(and(eq(c.workspaceId, ws), eq(c.id, id)))
        .returning();
      return r ? connection(r) : null;
    });
  }
  async createFlow(rec: OAuthFlow) {
    await withTenant(this.db, rec.workspaceId, async (tx) => {
      await tx.insert(f).values(rec);
    });
  }
  consumeState(provider: MetaProvider, stateHash: string, browserHash: string) {
    return withSystem(this.system, async (tx) => {
      const [r] = await tx
        .delete(f)
        .where(
          and(
            eq(f.provider, provider),
            eq(f.stateHash, stateHash),
            eq(f.browserHash, browserHash),
            sql`${f.expiresAt}>now()`,
            sql`${f.accountsSealed} is null`,
          ),
        )
        .returning();
      return r ? flow(r) : null;
    });
  }
  discovery(ws: WorkspaceId, userId: string, id: string) {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .select()
        .from(f)
        .where(
          and(
            eq(f.workspaceId, ws),
            eq(f.id, id),
            eq(f.userId, userId),
            sql`${f.expiresAt}>now()`,
            sql`${f.accountsSealed} is not null`,
            sql`${f.consumedAt} is null`,
          ),
        );
      return r ? flow(r) : null;
    });
  }
  select(ws: WorkspaceId, userId: string, id: string, accounts: ConnectionRecord[]) {
    return withTenant(this.db, ws, async (tx) => {
      const [d] = await tx
        .update(f)
        // The discovery held tokens for every granted page; drop them once the choice is made
        // so pages the user did not connect leave no credentials behind.
        .set({ consumedAt: new Date(), accountsSealed: null })
        .where(
          and(
            eq(f.workspaceId, ws),
            eq(f.id, id),
            eq(f.userId, userId),
            sql`${f.expiresAt}>now()`,
            sql`${f.consumedAt} is null`,
          ),
        )
        .returning();
      if (!d) throw new ChannelError('NOT_FOUND', 'Discovery expired or already consumed');
      const result: ConnectionRecord[] = [];
      for (const a of accounts) {
        const [row] = await tx
          .insert(c)
          .values({
            ...a,
            expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
            createdAt: new Date(a.createdAt),
          })
          .onConflictDoUpdate({
            target: [c.provider, c.externalId],
            set: {
              tokenSealed: a.tokenSealed,
              status: 'connected',
              name: a.name,
              expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
            },
            setWhere: eq(c.workspaceId, ws),
          })
          .returning();
        if (!row)
          throw new ChannelError('CONFLICT', 'This account is connected to another workspace');
        result.push(connection(row));
      }
      return result;
    });
  }
  claimEvents(limit: number) {
    return withSystem(this.system, async (tx) => {
      const rows = await tx
        .select()
        .from(e)
        .where(
          and(
            sql`${e.processedAt} is null`,
            sql`(${e.leaseUntil} is null or ${e.leaseUntil}<now())`,
            sql`${e.attempts}<${MAX_EVENT_ATTEMPTS}`,
            sql`${e.createdAt} < now() - interval '2 seconds'`,
          ),
        )
        .orderBy(e.createdAt)
        .limit(limit)
        .for('update', { skipLocked: true });
      const result: PendingMetaEvent[] = [];
      for (const row of rows) {
        const claimToken = newId();
        await tx
          .update(e)
          .set({
            leaseUntil: new Date(Date.now() + 180000),
            attempts: row.attempts + 1,
            claimToken,
          })
          .where(eq(e.id, row.id));
        const event = row.payload as NormalizedEvent;
        result.push({
          id: row.id,
          claimToken,
          workspaceId: row.workspaceId as WorkspaceId,
          connectionId: row.connectionId,
          attempt: row.attempts + 1,
          event: { ...event, occurredAt: new Date(event.occurredAt) },
        });
      }
      return result;
    });
  }
  async renewEvent(id: string, claimToken: string): Promise<boolean> {
    return withSystem(this.system, async (tx) => {
      const rows = await tx
        .update(e)
        .set({ leaseUntil: new Date(Date.now() + 180000) })
        .where(
          and(
            eq(e.id, id),
            // The claim token fences ownership: a lease that ran out during a long tick may still
            // be renewed as long as nobody re-claimed the event (which rotates the token).
            eq(e.claimToken, claimToken),
            sql`${e.processedAt} is null`,
          ),
        )
        .returning({ id: e.id });
      return rows.length > 0;
    });
  }
  async completeEvent(id: string, claimToken: string) {
    await withSystem(this.system, async (tx) => {
      await tx
        .update(e)
        .set({ processedAt: new Date(), leaseUntil: null })
        .where(and(eq(e.id, id), eq(e.claimToken, claimToken)));
    });
  }
  async deadLetterEvent(id: string, claimToken: string) {
    await withSystem(this.system, async (tx) => {
      const at = new Date();
      await tx
        .update(e)
        .set({ processedAt: at, failedAt: at, leaseUntil: null })
        .where(and(eq(e.id, id), eq(e.claimToken, claimToken), sql`${e.processedAt} is null`));
    });
  }
  async deadLetterExhaustedEvents() {
    return withSystem(this.system, async (tx) => {
      const at = new Date();
      const rows = await tx
        .update(e)
        .set({ processedAt: at, failedAt: at, leaseUntil: null })
        .where(
          and(
            sql`${e.processedAt} is null`,
            sql`${e.attempts}>=${MAX_EVENT_ATTEMPTS}`,
            sql`(${e.leaseUntil} is null or ${e.leaseUntil}<now())`,
          ),
        )
        .returning({ id: e.id });
      return rows.map((r) => r.id);
    });
  }
  async releaseEvent(id: string, claimToken: string, retryInMs: number) {
    await withSystem(this.system, async (tx) => {
      await tx
        .update(e)
        .set({ leaseUntil: new Date(Date.now() + retryInMs) })
        .where(and(eq(e.id, id), eq(e.claimToken, claimToken), sql`${e.processedAt} is null`));
    });
  }
}
export class UnavailableChannelStore implements ChannelStore {
  private fail(): never {
    throw new ChannelError('UNAVAILABLE', 'Channel storage needs tenant and system databases');
  }
  list(): Promise<ConnectionRecord[]> {
    return Promise.resolve([]);
  }
  get(): Promise<null> {
    return Promise.resolve(null);
  }
  update(): Promise<null> {
    return this.fail();
  }
  createFlow(): Promise<void> {
    return this.fail();
  }
  consumeState(): Promise<null> {
    return this.fail();
  }
  discovery(): Promise<null> {
    return this.fail();
  }
  select(): Promise<ConnectionRecord[]> {
    return this.fail();
  }
  claimEvents(): Promise<PendingMetaEvent[]> {
    return Promise.resolve([]);
  }
  renewEvent(): Promise<boolean> {
    return Promise.resolve(false);
  }
  completeEvent(): Promise<void> {
    return this.fail();
  }
  deadLetterEvent(): Promise<void> {
    return this.fail();
  }
  deadLetterExhaustedEvents(): Promise<string[]> {
    return Promise.resolve([]);
  }
  releaseEvent(): Promise<void> {
    return this.fail();
  }
}
