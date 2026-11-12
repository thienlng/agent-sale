import {
  and,
  desc,
  eq,
  schema,
  sql,
  withSystem,
  withTenant,
  type Database,
  type SQL,
} from '@agent-sales/db';
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
import {
  EVENT_MAX_WAIT_MS,
  EVENT_QUIET_MS,
  MAX_EVENT_ATTEMPTS,
  type ClaimOptions,
} from '../../api/channel.facade.js';
import { connection, flow } from './record-mappers.js';
import { findDiscovery, selectDiscoveredAccounts } from './oauth-discovery.js';
import { enqueueWebsiteEvent, findWebsiteRecord, hasPendingMessage } from './website.store.js';
const c = schema.channelConnections,
  f = schema.channelOauthFlows,
  e = schema.channelWebhookEvents;

/**
 * Ids of a fair inbox claim (security audit 2026-11-12 #3), picked per workspace in SQL so one
 * flooded shop's backlog cannot hide the others, however large it is. A conversation is a
 * connection + customer; each workspace's claimable conversations are ranked by their oldest
 * event and only the first `perWorkspace` take part. Their events are then ordered round-robin:
 * every admitted conversation's first event, then every second event, and so on, so the claim
 * reaches every workspace with work as long as `limit` covers the workspaces waiting. A
 * conversation always contributes a prefix of its events (its oldest ones), so its events keep
 * their order. `${e.*}` inside resolves to this subquery's own `channel_webhook_events`.
 */
function fairClaimIds(claimable: SQL | undefined, limit: number, perWorkspace: number): SQL {
  const sender = sql`coalesce(${e.payload}->>'senderExternalId', '')`;
  return sql`select r.id from (
    select k.id, k.created_at, k.ev_rank,
      dense_rank() over (
        partition by k.workspace_id order by k.first_at, k.connection_id, k.sender
      ) as conv_rank
    from (
      select ${e.id} as id, ${e.workspaceId} as workspace_id, ${e.connectionId} as connection_id,
        ${e.createdAt} as created_at, ${sender} as sender,
        min(${e.createdAt}) over (
          partition by ${e.workspaceId}, ${e.connectionId}, ${sender}
        ) as first_at,
        row_number() over (
          partition by ${e.workspaceId}, ${e.connectionId}, ${sender}
          order by ${e.createdAt}, ${e.id}
        ) as ev_rank
      from ${e}
      where ${claimable}
    ) k
  ) r
  where r.conv_rank <= ${perWorkspace}
  order by r.ev_rank, r.conv_rank, r.created_at
  limit ${limit}`;
}
export class DrizzleChannelStore implements ChannelStore {
  constructor(
    private readonly db: Database,
    private readonly system: Database,
  ) {}
  list(ws: WorkspaceId, opts: { includeRemoved?: boolean } = {}) {
    return withTenant(this.db, ws, async (tx) =>
      (
        await tx
          .select()
          .from(c)
          .where(
            opts.includeRemoved
              ? eq(c.workspaceId, ws)
              : and(eq(c.workspaceId, ws), sql`${c.status} <> 'removed'`),
          )
          .orderBy(desc(c.createdAt))
      ).map(connection),
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
  remove(ws: WorkspaceId, id: string, tokenSealed: string) {
    return withTenant(this.db, ws, async (tx) => {
      const [r] = await tx
        .update(c)
        .set({ status: 'removed', botId: null, tokenSealed, expiresAt: null })
        .where(and(eq(c.workspaceId, ws), eq(c.id, id), sql`${c.status} <> 'removed'`))
        .returning();
      return r ? connection(r) : null;
    });
  }
  create(rec: ConnectionRecord) {
    return withTenant(this.db, rec.workspaceId, async (tx) => {
      const [r] = await tx
        .insert(c)
        .values({
          ...rec,
          expiresAt: rec.expiresAt ? new Date(rec.expiresAt) : null,
          createdAt: new Date(rec.createdAt),
        })
        .returning();
      if (!r) throw new ChannelError('CONFLICT', 'Connection was not created');
      return connection(r);
    });
  }
  findWebsite(siteKey: string) {
    return findWebsiteRecord(this.system, siteKey);
  }
  enqueueEvent(rec: ConnectionRecord, event: NormalizedEvent) {
    return enqueueWebsiteEvent(this.system, rec, event);
  }
  hasPendingCustomerEvent(connectionId: string, senderExternalId: string) {
    return hasPendingMessage(this.system, connectionId, senderExternalId);
  }
  unbindBot(ws: WorkspaceId, botId: string) {
    return withTenant(this.db, ws, async (tx) => {
      const rows = await tx
        .update(c)
        .set({ botId: null })
        .where(and(eq(c.workspaceId, ws), eq(c.botId, botId)))
        .returning({ id: c.id });
      return rows.length;
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
    return findDiscovery(this.db, ws, userId, id);
  }
  select(ws: WorkspaceId, userId: string, id: string, accounts: ConnectionRecord[]) {
    return selectDiscoveredAccounts(this.db, ws, userId, id, accounts);
  }
  claimEvents(limit: number, options: ClaimOptions = {}) {
    return withSystem(this.system, async (tx) => {
      const claimable = and(
        sql`${e.processedAt} is null`,
        sql`(${e.leaseUntil} is null or ${e.leaseUntil}<now())`,
        sql`${e.attempts}<${MAX_EVENT_ATTEMPTS}`,
        // Wait for a quiet moment (the customer stopped typing) so a burst becomes one turn, but
        // never longer than the maximum wait for the oldest message of the burst.
        sql`(${e.createdAt} < now() - ${`${EVENT_MAX_WAIT_MS} milliseconds`}::interval or not exists (
          select 1 from channel_webhook_events n
          where n.connection_id = ${e.connectionId} and n.processed_at is null
            and n.payload->>'type' = 'message'
            and n.payload->>'senderExternalId' = ${e.payload}->>'senderExternalId'
            and n.created_at >= now() - ${`${EVENT_QUIET_MS} milliseconds`}::interval))`,
      );
      const perWorkspace =
        options.perWorkspace && options.perWorkspace > 0 ? options.perWorkspace : 0;
      const rows = await tx
        .select()
        .from(e)
        .where(
          perWorkspace
            ? and(claimable, sql`${e.id} in (${fairClaimIds(claimable, limit, perWorkspace)})`)
            : claimable,
        )
        // Claim order = receipt order, so each conversation's events run in order.
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
  async requeueEvent(id: string, claimToken: string) {
    await withSystem(this.system, async (tx) => {
      await tx
        .update(e)
        // Held back one quiet window: the newer message that interrupted this event clears its
        // own quiet window first, so the next claim takes both together (never the old one alone).
        .set({
          leaseUntil: sql`now() + ${`${EVENT_QUIET_MS + 50} milliseconds`}::interval`,
          attempts: sql`greatest(${e.attempts} - 1, 0)`,
        })
        .where(and(eq(e.id, id), eq(e.claimToken, claimToken), sql`${e.processedAt} is null`));
    });
  }
  async deferEvent(id: string, claimToken: string, delayMs: number) {
    await withSystem(this.system, async (tx) => {
      await tx
        .update(e)
        .set({
          leaseUntil: new Date(Date.now() + Math.max(0, delayMs)),
          attempts: sql`greatest(${e.attempts} - 1, 0)`,
        })
        .where(and(eq(e.id, id), eq(e.claimToken, claimToken), sql`${e.processedAt} is null`));
    });
  }
  hasNewerCustomerEvent(connectionId: string, senderExternalId: string, afterEventId: string) {
    return withSystem(this.system, async (tx) => {
      const rows = await tx
        .select({ id: e.id })
        .from(e)
        .where(
          and(
            eq(e.connectionId, connectionId),
            sql`${e.processedAt} is null`,
            sql`${e.id} > ${afterEventId}`,
            sql`${e.payload}->>'type' = 'message'`,
            sql`${e.payload}->>'senderExternalId' = ${senderExternalId}`,
          ),
        )
        .limit(1);
      return rows.length > 0;
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
  remove(): Promise<null> {
    return this.fail();
  }
  create(): Promise<ConnectionRecord> {
    return this.fail();
  }
  findWebsite(): Promise<null> {
    return Promise.resolve(null);
  }
  enqueueEvent(): Promise<boolean> {
    return this.fail();
  }
  hasPendingCustomerEvent(): Promise<boolean> {
    return Promise.resolve(false);
  }
  unbindBot(): Promise<number> {
    return Promise.resolve(0);
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
  requeueEvent(): Promise<void> {
    return this.fail();
  }
  deferEvent(): Promise<void> {
    return this.fail();
  }
  hasNewerCustomerEvent(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
