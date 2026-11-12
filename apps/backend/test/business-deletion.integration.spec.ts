import { BootstrapResponse, DeletedBusinessDto, DeletedBusinessList } from '@agent-sales/contracts';
import { PURGE_RETAINED_TABLES, schema, sql } from '@agent-sales/db';
import { newId, workspaceId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BILLING_FACADE, type BillingFacade } from '../src/modules/billing/api/index.js';
import {
  WORKSPACE_PURGE_RUNNER,
  type WorkspacePurgeRunner,
} from '../src/modules/workspace/api/index.js';
import {
  BUSINESS_OBJECT_ERASER,
  type BusinessObjectEraser,
} from '../src/modules/workspace/application/ports/workspace-purge.js';
import { type Harness, startHarness, type TestUser } from './support/harness.js';

/**
 * Business deletion over HTTP on Postgres (SET-10, ADR-032): owner-only request with the typed
 * name, every gate closes at once (membership guard, lists, billing entitlements, channels),
 * restore within the window, and the worker purge that leaves no row of the business in any
 * tenant table while another business keeps everything. Object storage is a recording stand-in.
 */
let h: Harness;
let owner: TestUser;
let member: TestUser;
let other: TestUser;
const erased: string[] = [];

beforeAll(async () => {
  h = await startHarness();
  owner = await h.user('del-owner@shop.vn', 'Chủ Shop');
  member = await h.user('del-member@shop.vn', 'Nhân viên');
  other = await h.user('del-other@shop.vn', 'Shop Khác');
  await h.owner.db.insert(schema.members).values({
    id: newId(),
    workspaceId: owner.ownWorkspace,
    userId: member.userId,
    role: 'admin',
    status: 'active',
  });
  const eraser = h.app.get<BusinessObjectEraser>(BUSINESS_OBJECT_ERASER, { strict: false });
  Object.assign(eraser, {
    available: () => true,
    erase: async (ws: string) => {
      erased.push(ws);
      return 2;
    },
  } satisfies BusinessObjectEraser);
});

afterAll(async () => {
  await h?.stop();
});

const name = () => 'Shop Chủ Shop';

async function seed(u: TestUser, label: string) {
  for (const [i, phone] of ['0901000001', '0901000002'].entries()) {
    const r = await h.call(u.h, 'POST', '/contacts', { name: `${label} ${i}`, phone });
    expect(r.statusCode, r.body).toBe(201);
  }
  const w = await h.call(u.h, 'POST', '/warehouses', { name: `Kho ${label}` });
  expect(w.statusCode, w.body).toBe(201);
  const p = await h.call(u.h, 'POST', '/products', {
    code: `${label}-1`,
    name: `Áo ${label}`,
    variants: [{ sku: `${label}-1-M`, price: 150_000 }],
  });
  expect(p.statusCode, p.body).toBe(201);
  const t = await h.call(u.h, 'POST', '/crm/tags', {
    name: `VIP ${label}`,
    type: 'classification',
  });
  expect(t.statusCode, t.body).toBe(201);
  const b = await h.call(u.h, 'POST', '/bots', { name: `Bot ${label}`, industry: 'fashion' });
  expect(b.statusCode, b.body).toBe(201);
  await h.owner.db.execute(sql`
    insert into channel_connections (id, workspace_id, provider, external_id, name, token_sealed)
    values (${newId()}, ${u.ownWorkspace}, 'facebook', ${newId()}, ${`Page ${label}`}, 'sealed')`);
}

async function tablesWithWorkspaceId(): Promise<string[]> {
  const rows = await h.owner.db.execute<{ name: string }>(sql`
    select c.relname as name from pg_attribute a
    join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attname = 'workspace_id' and not a.attisdropped
      and c.relkind in ('r', 'p') and not c.relispartition
    order by 1`);
  return rows.map((r) => r.name);
}

async function rowCounts(ws: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of await tablesWithWorkspaceId()) {
    const [r] = await h.owner.db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${ws}`,
    );
    if (r && r.n) out[table] = r.n;
  }
  return out;
}

async function memberships(u: TestUser) {
  return BootstrapResponse.parse((await h.call(u.auth, 'GET', '/bootstrap')).json()).memberships;
}

describe('business deletion', () => {
  it('is for the owner only and needs the exact business name', async () => {
    await seed(owner, 'A');
    await seed(other, 'B');
    const ws = owner.ownWorkspace;
    const wrong = await h.call(owner.auth, 'POST', `/workspaces/${ws}/deletion`, {
      confirmName: 'shop chủ shop',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.details.reason).toBe('name_mismatch');
    const byAdmin = await h.call(member.auth, 'POST', `/workspaces/${ws}/deletion`, {
      confirmName: name(),
    });
    expect(byAdmin.statusCode).toBe(403);
    const byStranger = await h.call(other.auth, 'POST', `/workspaces/${ws}/deletion`, {
      confirmName: name(),
    });
    expect(byStranger.statusCode).toBe(404);
    const unknown = await h.call(owner.auth, 'POST', `/workspaces/not-a-uuid/deletion`, {
      confirmName: name(),
    });
    expect(unknown.statusCode).toBe(404);
    expect((await h.call(owner.h, 'GET', '/workspaces/current')).statusCode).toBe(200);
  });

  it('closes every gate at once and lists the business for its owner to restore', async () => {
    const ws = owner.ownWorkspace;
    const r = await h.call(owner.auth, 'POST', `/workspaces/${ws}/deletion`, {
      confirmName: ` ${name()} `,
    });
    expect(r.statusCode, r.body).toBe(200);
    const deleted = DeletedBusinessDto.parse(r.json());
    expect(Date.parse(deleted.purgeAfter) - Date.parse(deleted.deletedAt)).toBe(30 * 86_400_000);

    for (const u of [owner, member]) {
      const current = await h.call(u.in(ws), 'GET', '/workspaces/current');
      expect(current.statusCode).toBe(404);
      expect(current.json().error.details.reason).toBe('workspace_access');
      expect((await memberships(u)).map((m) => m.workspaceId)).not.toContain(ws);
    }
    const listed = DeletedBusinessList.parse(
      (await h.call(owner.auth, 'GET', '/workspaces/deleted')).json(),
    );
    expect(listed.data.map((d) => d.workspaceId)).toEqual([ws]);
    expect(
      DeletedBusinessList.parse((await h.call(member.auth, 'GET', '/workspaces/deleted')).json())
        .data,
    ).toEqual([]);

    const billing = h.app.get<BillingFacade>(BILLING_FACADE, { strict: false });
    const wsId = workspaceId(ws);
    expect((await billing.entitlements(wsId)).features['feature.public_api']).toBe(false);
    expect(await billing.limit(wsId, 'care.messages.daily')).toBe(0);
    expect(
      await billing.reserveReply(wsId, {
        idempotencyKey: newId(),
        conversationId: null,
        botId: null,
      }),
    ).toMatchObject({ allowed: false });
    expect(
      (await billing.entitlements(workspaceId(other.ownWorkspace))).aiIncludedMessages?.amount,
    ).toBeGreaterThan(0);

    const pages = await h.owner.db.execute<{ status: string; token_sealed: string }>(
      sql`select status, token_sealed from channel_connections where workspace_id = ${ws}`,
    );
    expect(pages.map((p) => p.status)).toEqual(['removed']);
    expect(pages[0]?.token_sealed).not.toBe('sealed');

    const audit = await h.owner.db.execute<{ action: string }>(
      sql`select action from audit_events where workspace_id = ${ws} and action like 'workspace.%'`,
    );
    expect(audit.map((a) => a.action)).toContain('workspace.deletion_requested');
    const events = await h.owner.db.execute<{ type: string }>(
      sql`select type from outbox_events where workspace_id = ${ws} and type like 'workspace.workspace.%'`,
    );
    expect(events.map((e) => e.type)).toContain('workspace.workspace.deletion_requested.v1');
  });

  it('restores within the window; members are back, channels stay disconnected', async () => {
    const ws = owner.ownWorkspace;
    expect((await h.call(member.auth, 'POST', `/workspaces/${ws}/restore`)).statusCode).toBe(403);
    const r = await h.call(owner.auth, 'POST', `/workspaces/${ws}/restore`);
    expect(r.statusCode, r.body).toBe(200);
    expect((await h.call(member.in(ws), 'GET', '/workspaces/current')).statusCode).toBe(200);
    expect((await memberships(owner)).map((m) => m.workspaceId)).toContain(ws);
    const pages = await h.owner.db.execute<{ status: string }>(
      sql`select status from channel_connections where workspace_id = ${ws}`,
    );
    expect(pages.map((p) => p.status)).toEqual(['removed']);
    expect((await h.call(owner.auth, 'POST', `/workspaces/${ws}/restore`)).statusCode).toBe(409);
  });

  it('purges every row of the business after the window and leaves the other business whole', async () => {
    const ws = owner.ownWorkspace;
    const before = await rowCounts(other.ownWorkspace);
    expect(Object.keys(before).length).toBeGreaterThan(10);
    expect(
      (await h.call(owner.auth, 'POST', `/workspaces/${ws}/deletion`, { confirmName: name() }))
        .statusCode,
    ).toBe(200);
    // Not due yet: the scan finds nothing.
    const runner = h.app.get<WorkspacePurgeRunner>(WORKSPACE_PURGE_RUNNER, { strict: false });
    expect(await runner.tick()).toBe(0);
    expect(Object.keys(await rowCounts(ws)).length).toBeGreaterThan(10);

    await h.owner.db.execute(
      sql`update workspaces set purge_after = now() - interval '1 minute' where id = ${ws}`,
    );
    expect(await runner.tick(new Date(Date.now() + 10 * 60_000))).toBe(1);
    expect(erased).toEqual([ws]);

    const left = await rowCounts(ws);
    for (const table of Object.keys(left)) expect(PURGE_RETAINED_TABLES, table).toContain(table);
    expect(left['audit_events']).toBeGreaterThan(0);
    const [tomb] = await h.owner.db.execute<{
      status: string;
      name: string;
      purged_at: Date | null;
    }>(sql`select status, name, purged_at from workspaces where id = ${ws}`);
    expect(tomb).toMatchObject({ status: 'deleted', name: 'Deleted business' });
    expect(tomb?.purged_at).not.toBeNull();
    const purgedAudit = await h.owner.db.execute<{ action: string }>(
      sql`select action from audit_events where workspace_id = ${ws} and action = 'workspace.purged'`,
    );
    expect(purgedAudit).toHaveLength(1);

    expect(await rowCounts(other.ownWorkspace)).toEqual(before);
    expect((await h.call(owner.auth, 'POST', `/workspaces/${ws}/restore`)).statusCode).toBe(404);
    expect(
      DeletedBusinessList.parse((await h.call(owner.auth, 'GET', '/workspaces/deleted')).json())
        .data,
    ).toEqual([]);
    // The owner keeps their account and their other access; the purged business is gone.
    expect((await memberships(owner)).map((m) => m.workspaceId)).not.toContain(ws);
    expect((await h.call(other.h, 'GET', '/workspaces/current')).statusCode).toBe(200);
  });
});
