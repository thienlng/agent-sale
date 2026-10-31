import {
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  sql,
  withCredentials,
  withSystem,
  withTenant,
  type Database,
} from '@agent-sales/db';
import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startIngressListener } from '../../../common/db/ingress-listener.js';
import { createTickScheduler } from '../../../common/db/tick-scheduler.js';
import { EVENT_MAX_WAIT_MS, EVENT_QUIET_MS, MAX_EVENT_ATTEMPTS } from '../api/channel.facade.js';
import type { ConnectionRecord } from '../application/ports/channel-store.js';
import { DrizzleChannelStore } from '../infrastructure/persistence/channel.store.js';

/** The channel store's SQL on a real Postgres: OAuth discovery, page ownership, the inbox queue. */
let pg: TestPostgres;
const handles: { close: () => Promise<void> }[] = [];
let owner: Database;
let store: DrizzleChannelStore;
let rival: DrizzleChannelStore;
let a: WorkspaceId;
let b: WorkspaceId;
const users: Record<string, string> = {};

function open(url: string, max: number): Database {
  const h = createDb({ url, max });
  handles.push(h);
  return h.db;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  const systemUrl = withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password);
  owner = open(pg.ownerUrl, 1);
  // Two stores with their own pools stand in for two agent processes claiming concurrently.
  store = new DrizzleChannelStore(open(tenantUrl, 2), open(systemUrl, 2));
  rival = new DrizzleChannelStore(open(tenantUrl, 1), open(systemUrl, 1));
  a = workspaceId(newId());
  b = workspaceId(newId());
  const tenant = open(tenantUrl, 1);
  const system = open(systemUrl, 1);
  for (const ws of [a, b]) {
    const id = userId(newId());
    users[ws] = id;
    await withSystem(system, (tx) =>
      tx.insert(schema.users).values({ id, email: `${id}@example.test`, name: 'Owner' }),
    );
    await withTenant(tenant, ws, (tx) =>
      tx.insert(schema.workspaces).values({
        id: ws,
        workspaceId: ws,
        name: 'Shop',
        industry: 'retail',
        ownerUserId: id,
      }),
    );
  }
});

afterAll(async () => {
  for (const h of handles) await h.close();
  await pg?.stop();
});

function account(ws: WorkspaceId, externalId: string): ConnectionRecord {
  return {
    id: newId(),
    workspaceId: ws,
    provider: 'facebook',
    externalId,
    name: `Page ${externalId}`,
    status: 'connected',
    botId: null,
    tokenSealed: 'sealed-page-token',
    expiresAt: null,
    createdAt: new Date().toISOString(),
  };
}

async function discovery(ws: WorkspaceId): Promise<string> {
  const id = newId();
  await store.createFlow({
    id,
    workspaceId: ws,
    userId: users[ws] ?? '',
    provider: 'facebook',
    stateHash: newId(),
    browserHash: newId(),
    accountsSealed: 'sealed-tokens-of-every-granted-page',
    expiresAt: new Date(Date.now() + 600_000),
  });
  return id;
}

async function connect(ws: WorkspaceId, externalId: string): Promise<ConnectionRecord> {
  const [c] = await store.select(ws, users[ws] ?? '', await discovery(ws), [
    account(ws, externalId),
  ]);
  if (!c) throw new Error('connect failed');
  return c;
}

async function enqueue(ws: WorkspaceId, connectionId: string, n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, () => newId());
  await owner.insert(schema.channelWebhookEvents).values(
    ids.map((id) => ({
      id,
      workspaceId: ws,
      connectionId,
      externalId: id,
      payload: { kind: 'facebook', occurredAt: new Date().toISOString() },
      // The claim skips events younger than 2 s so a burst can group.
      createdAt: new Date(Date.now() - 10_000),
    })),
  );
  return ids;
}

const event = async (id: string) =>
  (
    await owner
      .select()
      .from(schema.channelWebhookEvents)
      .where(eq(schema.channelWebhookEvents.id, id))
  )[0];

describe('OAuth discovery and page ownership', () => {
  it('drops every sealed page token once the user picks pages, and is single-use', async () => {
    const flowId = await discovery(a);
    await store.select(a, users[a] ?? '', flowId, [account(a, 'page-1')]);
    const [flow] = await owner
      .select()
      .from(schema.channelOauthFlows)
      .where(eq(schema.channelOauthFlows.id, flowId));
    expect(flow?.accountsSealed).toBeNull();
    expect(flow?.consumedAt).not.toBeNull();
    await expect(
      store.select(a, users[a] ?? '', flowId, [account(a, 'page-1b')]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a page that is connected to another workspace', async () => {
    await connect(a, 'page-shared');
    await expect(connect(b, 'page-shared')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('hides connections from another tenant', async () => {
    const c = await connect(a, 'page-private');
    expect(await store.get(b, c.id)).toBeNull();
    expect((await store.list(b)).map((x) => x.id)).not.toContain(c.id);
    expect(await store.update(b, c.id, { status: 'disconnected' })).toBeNull();
  });
});

describe('Soft removal (T-133)', () => {
  it('hides the page from the list, unbinds it and keeps the row, then OAuth restores the same row', async () => {
    const c = await connect(a, 'page-removable');
    await store.update(a, c.id, { botId: null });
    const removed = await store.remove(a, c.id, 'sealed-empty');
    expect(removed).toMatchObject({ id: c.id, status: 'removed', botId: null });
    expect((await store.list(a)).map((x) => x.id)).not.toContain(c.id);
    expect((await store.list(a, { includeRemoved: true })).map((x) => x.id)).toContain(c.id);
    expect((await store.list(b, { includeRemoved: true })).map((x) => x.id)).not.toContain(c.id);
    expect((await store.get(a, c.id))?.tokenSealed).toBe('sealed-empty');
    expect(await store.remove(a, c.id, 'x')).toBeNull();
    const [again] = await store.select(a, users[a] ?? '', await discovery(a), [
      account(a, 'page-removable'),
    ]);
    expect(again).toMatchObject({
      id: c.id,
      status: 'connected',
      tokenSealed: 'sealed-page-token',
    });
    expect((await store.list(a)).map((x) => x.id)).toContain(c.id);
  });

  it('lets another business connect a removed page as a new row and keeps the old one removed (T-142)', async () => {
    const old = await connect(a, 'page-moved');
    await store.remove(a, old.id, 'sealed-empty');
    const moved = await connect(b, 'page-moved');
    expect(moved.id).not.toBe(old.id);
    expect(moved).toMatchObject({ workspaceId: b, status: 'connected' });
    expect(await store.get(a, old.id)).toMatchObject({ id: old.id, status: 'removed' });
    expect((await store.list(b)).map((x) => x.id)).toContain(moved.id);
    expect((await store.list(a)).map((x) => x.id)).not.toContain(old.id);
  });

  it('blocks a live page of another business, also after the page moved away and back (T-142)', async () => {
    const first = await connect(a, 'page-roundtrip');
    await store.remove(a, first.id, 'sealed-empty');
    const second = await connect(b, 'page-roundtrip');
    // Live in b: a cannot take it, and a's removed row must stay removed.
    await expect(connect(a, 'page-roundtrip')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await store.get(a, first.id))?.status).toBe('removed');
    // b removes it: a revives its own row (same id), no third row appears.
    await store.remove(b, second.id, 'sealed-empty');
    const back = await connect(a, 'page-roundtrip');
    expect(back.id).toBe(first.id);
    expect(back.status).toBe('connected');
    const rows = await owner
      .select()
      .from(schema.channelConnections)
      .where(eq(schema.channelConnections.externalId, 'page-roundtrip'));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status !== 'removed')).toHaveLength(1);
  });

  it('makes two live rows for one page impossible in the database (T-142)', async () => {
    await connect(a, 'page-unique');
    await expect(
      owner.insert(schema.channelConnections).values({
        id: newId(),
        workspaceId: b,
        provider: 'facebook',
        externalId: 'page-unique',
        name: 'Duplicate',
        tokenSealed: 'sealed',
      }),
    ).rejects.toThrow();
  });

  it('cannot remove another tenant page', async () => {
    const c = await connect(a, 'page-not-yours');
    expect(await store.remove(b, c.id, 'x')).toBeNull();
    expect((await store.get(a, c.id))?.status).toBe('connected');
  });

  it('accepts the removed status in the database and still rejects unknown ones', async () => {
    const c = await connect(a, 'page-check');
    await owner
      .update(schema.channelConnections)
      .set({ status: 'removed' })
      .where(eq(schema.channelConnections.id, c.id));
    await expect(
      owner
        .update(schema.channelConnections)
        .set({ status: 'deleted' })
        .where(eq(schema.channelConnections.id, c.id)),
    ).rejects.toThrow();
  });
});

describe('Inbox queue', () => {
  it('never hands the same event to two concurrent claimers', async () => {
    const c = await connect(a, 'page-queue');
    const ids = await enqueue(a, c.id, 6);
    const [x, y] = await Promise.all([store.claimEvents(4), rival.claimEvents(4)]);
    const claimed = [...(x ?? []), ...(y ?? [])].map((j) => j.id).filter((id) => ids.includes(id));
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.sort()).toEqual([...ids].sort());
    for (const j of [...(x ?? []), ...(y ?? [])]) await store.completeEvent(j.id, j.claimToken);
  });

  it('fences a stale claim token and still renews an expired lease nobody re-claimed', async () => {
    const c = await connect(a, 'page-fence');
    const [id] = await enqueue(a, c.id, 1);
    const [first] = await store.claimEvents(10);
    expect(first?.id).toBe(id);
    // The lease ran out during a long tick, but nobody else claimed it: renewing is safe.
    await owner.execute(
      sql`update channel_webhook_events set lease_until = now() - interval '1 second' where id = ${id}`,
    );
    expect(await store.renewEvent(first!.id, first!.claimToken)).toBe(true);
    // Released and re-claimed by another worker: the old token loses every write.
    await store.releaseEvent(first!.id, first!.claimToken, 0);
    await owner.execute(
      sql`update channel_webhook_events set lease_until = now() - interval '1 second' where id = ${id}`,
    );
    const [second] = await rival.claimEvents(10);
    expect(second?.id).toBe(id);
    expect(await store.renewEvent(first!.id, first!.claimToken)).toBe(false);
    await store.completeEvent(first!.id, first!.claimToken);
    expect((await event(id!))?.processedAt).toBeNull();
    await rival.completeEvent(second!.id, second!.claimToken);
    expect((await event(id!))?.processedAt).not.toBeNull();
  });

  async function message(connectionId: string, sender: string, ageMs: number): Promise<string> {
    const id = newId();
    await owner.insert(schema.channelWebhookEvents).values({
      id,
      workspaceId: a,
      connectionId,
      externalId: id,
      payload: { kind: 'facebook', type: 'message', senderExternalId: sender },
      createdAt: new Date(Date.now() - ageMs),
    });
    return id;
  }

  it('waits for a quiet moment so a burst is answered together, but never past the max wait', async () => {
    const c = await connect(a, 'page-quiet');
    const first = await message(c.id, 'cust-1', 1500);
    const second = await message(c.id, 'cust-1', 100); // still typing: holds the whole burst
    const other = await message(c.id, 'cust-2', 1500); // another customer is not held back
    const claimed = (await store.claimEvents(10)).map((j) => j.id);
    expect(claimed).toContain(other);
    expect(claimed).not.toContain(first);
    expect(claimed).not.toContain(second);
    // Once the burst has been quiet long enough, both go out in the same claim.
    await owner.execute(
      sql`update channel_webhook_events set created_at = now() - interval '2 seconds' where id in (${first}, ${second})`,
    );
    const later = (await store.claimEvents(10)).map((j) => j.id);
    expect(later).toEqual(expect.arrayContaining([first, second]));
  });

  it('claims a fresh message through NOTIFY plus the trailing tick well before the 5 s safety poll', async () => {
    const c = await connect(a, 'page-notify');
    const claimed: string[] = [];
    const scheduler = createTickScheduler({
      tick: async () => {
        for (const j of await store.claimEvents(10)) claimed.push(j.id);
      },
      trailingMs: EVENT_QUIET_MS + 50,
      maxTrailingMs: EVENT_MAX_WAIT_MS,
    });
    let up = false;
    const listener = startIngressListener({
      url: pg.ownerUrl,
      channel: 'rapiz_ingress',
      onNotify: () => scheduler.notify(),
      onState: (state) => {
        up = state;
        scheduler.setListenerUp(state);
      },
      backoff: { minMs: 100, maxMs: 400 },
    });
    try {
      const end = Date.now() + 5_000;
      while (!up && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      expect(up).toBe(true);
      await new Promise((r) => setTimeout(r, 100)); // let the catch-up tick settle
      const t0 = Date.now();
      const id = await message(c.id, 'cust-notify', 0);
      while (!claimed.includes(id) && Date.now() - t0 < 3_000)
        await new Promise((r) => setTimeout(r, 20));
      const took = Date.now() - t0;
      expect(claimed).toContain(id);
      expect(took).toBeLessThan(1_500);
      await store.completeEvent(id, (await event(id))!.claimToken!);
    } finally {
      scheduler.stop();
      await listener.stop();
    }
  });

  it('claims the oldest message of a burst after the max wait even if the customer keeps typing', async () => {
    const c = await connect(a, 'page-maxwait');
    const old = await message(c.id, 'cust-3', 5000);
    await message(c.id, 'cust-3', 50);
    expect((await store.claimEvents(10)).map((j) => j.id)).toContain(old);
  });

  it('sees newer unprocessed customer messages and requeues without spending an attempt', async () => {
    const c = await connect(a, 'page-newer');
    const first = await message(c.id, 'cust-4', 10_000);
    const [job] = (await store.claimEvents(10)).filter((j) => j.id === first);
    expect(job?.attempt).toBe(1);
    expect(await store.hasNewerCustomerEvent(c.id, 'cust-4', first)).toBe(false);
    await message(c.id, 'cust-4', 0);
    expect(await store.hasNewerCustomerEvent(c.id, 'cust-4', first)).toBe(true);
    expect(await store.hasNewerCustomerEvent(c.id, 'cust-5', first)).toBe(false);
    await store.requeueEvent(first, job!.claimToken);
    const requeued = await event(first);
    expect(requeued?.attempts).toBe(0);
    // Held back for one quiet window instead of being claimable at once.
    expect(requeued?.leaseUntil).not.toBeNull();
    expect(requeued!.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('holds a requeued event back until the newer message clears its quiet window, then claims both', async () => {
    const c = await connect(a, 'page-requeue');
    // E1 is older than the max wait, so only its lease can hold it back.
    const e1 = await message(c.id, 'cust-6', 10_000);
    const [job] = (await store.claimEvents(10)).filter((j) => j.id === e1);
    expect(job).toBeDefined();
    await store.requeueEvent(e1, job!.claimToken);
    const e2 = await message(c.id, 'cust-6', 0);
    const ours = (ids: string[]) => ids.filter((id) => id === e1 || id === e2);
    // Right away: E1 is still leased and E2 is inside its quiet window.
    expect(ours((await store.claimEvents(10)).map((j) => j.id))).toEqual([]);
    await new Promise((r) => setTimeout(r, EVENT_QUIET_MS + 150));
    // After the window: the trailing tick takes them together, so the re-run sees both messages.
    expect(ours((await store.claimEvents(10)).map((j) => j.id)).sort()).toEqual([e1, e2].sort());
  });

  it('dead-letters failed and exhausted events so they leave the queue with their payload', async () => {
    const c = await connect(a, 'page-dead');
    const [failed, crashed] = await enqueue(a, c.id, 2);
    const jobs = await store.claimEvents(10);
    const job = jobs.find((j) => j.id === failed);
    await store.deadLetterEvent(job!.id, job!.claimToken);
    const row = await event(failed!);
    expect(row?.failedAt).not.toBeNull();
    expect(row?.processedAt).not.toBeNull();
    expect(row?.payload).toBeTruthy();
    // A worker died during the last attempt: the sweep dead-letters it once the lease is over.
    await owner.execute(
      sql`update channel_webhook_events set attempts = ${MAX_EVENT_ATTEMPTS}, lease_until = now() - interval '1 second' where id = ${crashed}`,
    );
    expect(await store.deadLetterExhaustedEvents()).toContain(crashed);
    expect((await event(crashed!))?.failedAt).not.toBeNull();
    expect((await store.claimEvents(10)).map((j) => j.id)).not.toContain(crashed);
  });
});
