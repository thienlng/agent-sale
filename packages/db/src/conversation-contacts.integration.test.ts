import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, MIGRATIONS_DIR, withCredentials } from './migrate.js';
import { withTenant } from './tenant.js';

/**
 * Migration 0030 (T-088): website conversations that captured a lead get their customer, the
 * customer remembers the bot, and a conversation can never point at another business's customer.
 */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };

async function migrationsUpTo(last: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  for (const f of await readdir(MIGRATIONS_DIR))
    if (f <= last) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}

const user = newId();
const shopA = newId();
const shopB = newId();
const botA = newId();
const site = newId();
const lan = newId(); // customer of A
const minh = newId(); // customer of B
const withLead = newId();
const foreignLead = newId(); // lead pointing at B's customer (never linked)
const noLead = newId();

const exec = (q: ReturnType<typeof sql>) => owner.db.execute(q);
const rows = async <T>(q: ReturnType<typeof sql>) => (await exec(q)) as unknown as T[];

beforeAll(async () => {
  pg = await startTestPostgres();
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl, await migrationsUpTo('0029_bot_catalog_selection.sql'));
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });

  await exec(sql`insert into users (id, email, name) values (${user}, 'lan@example.test', 'Lan')`);
  for (const ws of [shopA, shopB])
    await exec(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${ws}, ${ws}, 'Shop', 'retail', ${user})`);
  await exec(sql`insert into bots (id, workspace_id, name, industry, settings)
    values (${botA}, ${shopA}, 'Bot', 'retail', '{}'::jsonb)`);
  await exec(sql`insert into channel_connections (id, workspace_id, provider, external_id, name, token_sealed, bot_id)
    values (${site}, ${shopA}, 'website', ${site}, 'Site', 'sealed', ${botA})`);
  for (const [id, ws] of [
    [lan, shopA],
    [minh, shopB],
  ] as const)
    await exec(sql`insert into contacts (id, workspace_id, name) values (${id}, ${ws}, 'Khách')`);
  for (const [conv, contact] of [
    [withLead, lan],
    [foreignLead, minh],
    [noLead, null],
  ] as const) {
    const data = contact ? { lead: { contactId: contact, phone: '+84903456781' } } : {};
    await exec(sql`insert into conversations (id, workspace_id, channel_id, customer_id, bot_id, data)
      values (${conv}, ${shopA}, ${site}, ${conv}, ${botA}, ${JSON.stringify(data)}::jsonb)`);
  }

  await migrate(pg.ownerUrl);
});

afterAll(async () => {
  await tenant?.close();
  await owner?.close();
  await pg?.stop();
});

describe('conversation customers (0030)', () => {
  it('links captured website leads of the same business and records their bot', async () => {
    const linked = await rows<{ id: string; contact_id: string | null }>(
      sql`select id, contact_id from conversations order by id`,
    );
    expect(Object.fromEntries(linked.map((r) => [r.id, r.contact_id]))).toEqual({
      [withLead]: lan,
      [foreignLead]: null,
      [noLead]: null,
    });
    expect(await rows(sql`select workspace_id, contact_id, bot_id from contact_bots`)).toEqual([
      { workspace_id: shopA, contact_id: lan, bot_id: botA },
    ]);
  });

  it('rejects a link to another business customer', async () => {
    await expect(
      exec(sql`update conversations set contact_id = ${minh} where id = ${noLead}`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'conversations_contact_fk' } });
    await expect(
      exec(sql`insert into contact_bots (workspace_id, contact_id, bot_id)
        values (${shopA}, ${minh}, ${botA})`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'contact_bots_contact_fk' } });
  });

  it('shows a business only its own customer bots', async () => {
    const seen = (ws: string) =>
      withTenant(tenant.db, workspaceId(ws), (tx) => tx.execute(sql`select * from contact_bots`));
    expect(await seen(shopA)).toHaveLength(1);
    expect(await seen(shopB)).toHaveLength(0);
  });
});
