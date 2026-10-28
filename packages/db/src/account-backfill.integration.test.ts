import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { backfillAccounts } from './account-backfill.js';
import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, MIGRATIONS_DIR, withCredentials } from './migrate.js';
import { withTenant } from './tenant.js';

/**
 * Upgrading an install that has no accounts (migration 0028, T-078, ADR-012 §8): the expand
 * migration keeps every row valid, the backfill gives each workspace an account, attributes
 * conversations and facts to bots, unbinds inconsistent channels and reports what it did not guess.
 */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };

async function migrationsUpTo(last: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  for (const f of await readdir(MIGRATIONS_DIR))
    if (f <= last) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}

// Lan owns two businesses; Minh owns one; Hoa's business lost its owner membership.
const lan = newId();
const minh = newId();
const hoa = newId();
const b1 = newId();
const b2 = newId();
const b3 = newId();
const orphan = newId();
const f1 = newId(); // bot of B1
const e1 = newId(); // bot of B3
const e2 = newId(); // bot of B3, soft-deleted before the unbind hook existed
const pageB1 = newId(); // bound to F1
const pageB3Deleted = newId(); // B3 page still bound to the deleted E2
const pageB3Foreign = newId(); // B3 page bound to B1's bot F1 (impossible after 0028)
const pageB2Missing = newId(); // B2 page bound to a bot that does not exist
const convB1 = newId();
const convB3 = newId();

const exec = (q: ReturnType<typeof sql>) => owner.db.execute(q);

beforeAll(async () => {
  pg = await startTestPostgres();
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl, await migrationsUpTo('0027_webchat_visitor_messages.sql'));
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  system = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });

  for (const [id, name] of [
    [lan, 'Lan'],
    [minh, 'Minh'],
    [hoa, 'Hoa'],
  ] as const)
    await exec(
      sql`insert into users (id, email, name) values (${id}, ${`${id}@example.test`}, ${name})`,
    );
  for (const [ws, user, name] of [
    [b1, lan, 'Lan Fashion'],
    [b2, lan, 'Lan Homestay'],
    [b3, minh, 'Minh English'],
    [orphan, hoa, 'Hoa Shop'],
  ] as const) {
    await exec(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${ws}, ${ws}, ${name}, 'retail', ${user})`);
    if (ws !== orphan)
      await exec(sql`insert into members (id, workspace_id, user_id, role)
        values (${newId()}, ${ws}, ${user}, 'owner')`);
  }
  for (const [bot, ws] of [
    [f1, b1],
    [e1, b3],
  ] as const)
    await exec(sql`insert into bots (id, workspace_id, name, industry, settings)
      values (${bot}, ${ws}, 'Bot', 'retail', '{}'::jsonb)`);
  await exec(sql`insert into bots (id, workspace_id, name, industry, settings, deleted_at)
    values (${e2}, ${b3}, 'Deleted bot', 'retail', '{}'::jsonb, now())`);
  for (const [ch, ws, bot] of [
    [pageB1, b1, f1],
    [pageB3Foreign, b3, f1],
    [pageB2Missing, b2, newId()],
    [pageB3Deleted, b3, e2],
  ] as const)
    await exec(sql`insert into channel_connections (id, workspace_id, provider, external_id, name, token_sealed, bot_id)
      values (${ch}, ${ws}, 'facebook', ${ch}, 'Page', 'sealed', ${bot})`);
  for (const [conv, ws, ch] of [
    [convB1, b1, pageB1],
    [convB3, b3, pageB3Foreign],
  ] as const) {
    await exec(sql`insert into conversations (id, workspace_id, channel_id, customer_id, data)
      values (${conv}, ${ws}, ${ch}, ${conv}, '{}'::jsonb)`);
    await exec(sql`insert into analytics_facts (workspace_id, outbox_id, kind, occurred_at, received_at, origin, conversation_id, channel_id)
      values (${ws}, ${Math.floor(Math.random() * 1e9)}, 'message.inbound', now(), now(), 'channel', ${conv}, ${ch})`);
  }
  for (const ws of [b1, b2])
    await exec(
      sql`insert into subscriptions (workspace_id, plan_code, plan_version) values (${ws}, 'sales_smart', 1)`,
    );

  await migrate(pg.ownerUrl);
});

afterAll(async () => {
  await tenant?.close();
  await system?.close();
  await owner?.close();
  await pg?.stop();
});

const one = async <T>(q: ReturnType<typeof sql>) => ((await exec(q)) as unknown as T[])[0];

describe('account backfill (0028, ADR-012 §8)', () => {
  it('keeps legacy rows valid and changes nothing in a dry run', async () => {
    const report = await backfillAccounts(system.db, { dryRun: true });
    expect(report).toMatchObject({ dryRun: true, accountsCreated: 2, workspacesLinked: 3 });
    expect(await one(sql`select count(*)::int as n from accounts`)).toEqual({ n: 0 });
    expect(
      await one(sql`select bot_id from channel_connections where id = ${pageB3Foreign}`),
    ).toEqual({ bot_id: f1 });
  });

  it('gives each owner one account, reports what it does not guess, and unbinds broken channels', async () => {
    const report = await backfillAccounts(system.db, { dryRun: false });
    expect(report.accountsCreated).toBe(2);
    expect(report.workspacesLinked).toBe(3);
    expect(report.workspacesSkipped).toEqual([
      { workspaceId: orphan, reason: 'owner_not_active_member' },
    ]);
    expect(report.channelsUnbound).toHaveLength(3);
    expect(report.channelsUnbound.map((c) => c.channelId).sort()).toEqual(
      [pageB3Foreign, pageB2Missing, pageB3Deleted].sort(),
    );
    expect(report.conversationsAttributed).toBe(1);
    expect(report.factsAttributed).toEqual([{ workspaceId: b1, facts: 1 }]);

    const lanAccount = await one<{ account_id: string }>(
      sql`select account_id from workspaces where id = ${b1}`,
    );
    expect(await one(sql`select account_id from workspaces where id = ${b2}`)).toEqual(lanAccount);
    expect(await one(sql`select role from account_members where user_id = ${lan}`)).toEqual({
      role: 'owner',
    });
    expect(report.subscriptionConflicts).toEqual([
      { accountId: lanAccount?.account_id, workspaceIds: [b1, b2].sort() },
    ]);
    expect(await one(sql`select bot_id from conversations where id = ${convB1}`)).toEqual({
      bot_id: f1,
    });
    expect(await one(sql`select bot_id from conversations where id = ${convB3}`)).toEqual({
      bot_id: null,
    });
  });

  it('is idempotent', async () => {
    const again = await backfillAccounts(system.db, { dryRun: false });
    expect(again).toMatchObject({
      accountsCreated: 0,
      workspacesLinked: 0,
      channelsUnbound: [],
      conversationsAttributed: 0,
      factsAttributed: [],
    });
    expect(again.workspacesSkipped).toHaveLength(1);
    expect(await one(sql`select count(*)::int as n from accounts`)).toEqual({ n: 2 });
  });

  it('rejects binding a channel or a conversation to another workspace bot', async () => {
    await expect(
      exec(sql`update channel_connections set bot_id = ${f1} where id = ${pageB3Foreign}`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'channel_connections_bot_fk' } });
    await expect(
      exec(sql`update conversations set bot_id = ${f1} where id = ${convB3}`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'conversations_bot_fk' } });
    await exec(sql`update channel_connections set bot_id = ${e1} where id = ${pageB3Foreign}`);
  });

  it('keeps the global account tables away from tenant connections', async () => {
    await expect(
      withTenant(tenant.db, workspaceId(b1), (tx) => tx.execute(sql`select * from accounts`)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      withTenant(tenant.db, workspaceId(b1), (tx) =>
        tx.execute(sql`select * from account_members`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});
