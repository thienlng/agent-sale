import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AssistantSqlError,
  createAssistantSqlClient,
  runAssistantSql,
  type AssistantSqlClient,
} from './assistant-sql.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';

/**
 * The owner assistant's read-only SQL lane (0059, T-171) against a real Postgres: the login's
 * grants, the reader's column grants and RLS policies, account and business isolation on one
 * pooled connection, the read-only transaction, the timeout, the row cap and the extended
 * protocol. Seeded as the owner (superuser): accounts A (businesses A1, A2 and a deleted A3) and
 * B (business B1), each business with orders, items, contacts, facts, a bot and a channel.
 */
let pg: TestPostgres;
let owner: postgres.Sql;
let lane: { sql: AssistantSqlClient; close(): Promise<void> };
let login: string;

const accountA = newId();
const accountB = newId();
const A1 = newId();
const A2 = newId();
const A3 = newId(); // deleted
const B1 = newId();
const names: Record<string, string> = { [A1]: 'A1', [A2]: 'A2', [A3]: 'A3', [B1]: 'B1' };

const VIEWS: Record<string, string[]> = {
  businesses: ['business_id', 'name', 'industry', 'timezone', 'created_at'],
  orders: [
    'order_id',
    'business_id',
    'code',
    'status',
    'counts_as_revenue',
    'is_cancelled',
    'source',
    'created_by_kind',
    'item_qty',
    'subtotal',
    'discount_amount',
    'shipping_fee',
    'shipping_fee_charged',
    'total',
    'paid',
    'remaining',
    'cod_amount',
    'cost_total',
    'profit',
    'customer_name',
    'carrier',
    'conversation_id',
    'placed_at',
    'confirmed_at',
    'cancelled_at',
  ],
  order_items: [
    'order_item_id',
    'business_id',
    'order_id',
    'product_id',
    'variant_id',
    'product_name',
    'variant_name',
    'sku',
    'qty',
    'unit_price',
    'unit_cost',
    'line_total',
    'order_status',
    'counts_as_revenue',
    'placed_at',
  ],
  products: [
    'product_id',
    'business_id',
    'code',
    'name',
    'category',
    'status',
    'visible_to_bot',
    'created_at',
  ],
  product_variants: [
    'variant_id',
    'business_id',
    'product_id',
    'sku',
    'name',
    'price',
    'cost',
    'archived',
    'stock_on_hand',
    'stock_reserved',
  ],
  customers: [
    'customer_id',
    'business_id',
    'name',
    'province',
    'source_name',
    'first_source_name',
    'status_name',
    'has_phone',
    'archived',
    'created_at',
  ],
  conversations: [
    'conversation_id',
    'business_id',
    'channel_id',
    'channel_provider',
    'bot_id',
    'customer_id',
    'status',
    'mode',
    'created_at',
    'last_activity_at',
  ],
  channels: ['channel_id', 'business_id', 'provider', 'name', 'status', 'bot_id', 'created_at'],
  bots: ['bot_id', 'business_id', 'name', 'industry', 'is_active', 'order_taking', 'created_at'],
  activity_events: [
    'business_id',
    'kind',
    'occurred_at',
    'origin',
    'customer_id',
    'conversation_id',
    'channel_id',
    'bot_id',
  ],
  lodging_bookings: [
    'booking_id',
    'business_id',
    'property_id',
    'property_name',
    'code',
    'status',
    'source',
    'check_in',
    'check_out',
    'nights',
    'adults',
    'children',
    'guest_name',
    'total_sell',
    'adjustment',
    'total_cost',
    'counts_as_revenue',
    'created_at',
  ],
};

const NEVER_GRANTED: Record<string, string[]> = {
  contacts: [
    'phone',
    'phone_normalized',
    'email',
    'email_normalized',
    'birthday',
    'gender',
    'address',
    'ward',
    'profile_note',
  ],
  orders: ['recipient', 'note_internal', 'note_print', 'created_by_name', 'tracking_code'],
  conversations: ['customer_id', 'customer_phone', 'data'],
  channel_connections: ['token_sealed', 'external_id', 'settings'],
  bots: ['settings'],
  lodging_bookings: ['guest_phone', 'note', 'quote'],
};

async function seedBusiness(ws: string, account: string, ownerUser: string, deleted = false) {
  const tag = names[ws] ?? 'X';
  const warehouse = newId();
  const product = newId();
  const variant = newId();
  const source = newId();
  const withPhone = newId();
  const noPhone = newId();
  const bot = newId();
  const channel = newId();
  const conversation = newId();
  const property = newId();
  await owner`insert into workspaces (id, workspace_id, name, industry, owner_user_id, account_id, deleted_at)
    values (${ws}, ${ws}, ${'Shop ' + tag}, 'fashion', ${ownerUser}, ${account}, ${deleted ? new Date() : null})`;
  await owner`insert into warehouses (id, workspace_id, name) values (${warehouse}, ${ws}, 'Kho')`;
  await owner`insert into products (id, workspace_id, code, name, search_text)
    values (${product}, ${ws}, ${'P-' + tag}, ${'Áo ' + tag}, '')`;
  await owner`insert into product_variants (id, workspace_id, product_id, sku, price, cost)
    values (${variant}, ${ws}, ${product}, ${'SKU-' + tag}, 150000, 90000)`;
  await owner`insert into inventory (workspace_id, variant_id, warehouse_id, on_hand, reserved)
    values (${ws}, ${variant}, ${warehouse}, 7, 2)`;
  await owner`insert into crm_sources (id, workspace_id, name, color, position)
    values (${source}, ${ws}, 'Facebook', '#000', 0)`;
  await owner`insert into contacts (id, workspace_id, name, phone, email, address, profile_note,
      search_text, source_id, first_source_id, phone_provided_at)
    values (${withPhone}, ${ws}, ${'Khách ' + tag}, '0912345678', 'k@example.test', '1 Phố Huế',
      'VIP', '', ${source}, ${source}, now())`;
  await owner`insert into contacts (id, workspace_id, name, profile_note, search_text)
    values (${noPhone}, ${ws}, ${'Khách mới ' + tag}, '', '')`;
  await owner`insert into bots (id, workspace_id, name, industry, settings)
    values (${bot}, ${ws}, ${'Bot ' + tag}, 'fashion', '{"secret": "x"}')`;
  await owner`insert into channel_connections (id, workspace_id, provider, external_id, name, status, bot_id, token_sealed)
    values (${channel}, ${ws}, 'facebook', ${'page-' + tag}, ${'Page ' + tag}, 'connected', ${bot}, 'sealed')`;
  await owner`insert into conversations (id, workspace_id, channel_id, customer_id, data, contact_id, bot_id, customer_phone)
    values (${conversation}, ${ws}, ${channel}, ${'psid-' + tag}, '{"messages": []}', ${withPhone}, ${bot}, '0912345678')`;
  for (const [status, total] of [
    ['delivered', 200000],
    ['cancelled', 50000],
  ] as const) {
    const order = newId();
    await owner`insert into orders (id, workspace_id, code, status, stock_state, source, warehouse_id,
        customer, recipient, item_qty, subtotal, discount_type, discount_value, discount_amount,
        shipping_fee, shipping_fee_charged, surcharge, transfer_amount, total, paid, remaining,
        cod_amount, cost_total, placed_at, search_text, note_internal, tracking_code)
      values (${order}, ${ws}, ${tag + '-' + status}, ${status}, 'shipped', 'manual', ${warehouse},
        ${owner.json({ name: 'Khách ' + tag, phone: '0912345678' })},
        ${owner.json({ name: 'Người nhận', phone: '0987654321', address: '1 Phố Huế' })},
        1, ${total}, 'amount', 0, 0, 30000, 20000, 0, 0, ${total}, 0, ${total}, ${total}, 90000,
        now(), '', 'secret note', 'TRACK')`;
    await owner`insert into order_items (id, workspace_id, order_id, variant_id, product_name,
        variant_name, sku, qty, unit_price, unit_cost, line_total)
      values (${newId()}, ${ws}, ${order}, ${variant}, ${'Áo ' + tag}, 'M', ${'SKU-' + tag}, 1,
        ${total}, 90000, ${total})`;
  }
  await owner`insert into analytics_facts (workspace_id, outbox_id, kind, occurred_at, received_at, origin, contact_id)
    values (${ws}, ${Math.floor(Math.random() * 1e9)}, 'customer.created', now(), now(), 'bot', ${withPhone})`;
  await owner`insert into lodging_properties (id, workspace_id, code, name, sell_mode, standard_adults)
    values (${property}, ${ws}, ${'V-' + tag}, ${'Villa ' + tag}, 'whole', 2)`;
  await owner`insert into lodging_bookings (id, workspace_id, property_id, code, kind, whole, status,
      check_in, check_out, adults, child_ages, guest_name, guest_phone, client_request_id,
      fingerprint, total_sell, note)
    values (${newId()}, ${ws}, ${property}, ${'B-' + tag}, 'stay', true, 'confirmed', '2026-11-01',
      '2026-11-04', 2, '{5,8}', ${'Khách ' + tag}, '0912345678', ${newId()}, ${newId()}, 3000000,
      'secret')`;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, {
    tenant: pg.tenantLogin,
    system: pg.systemLogin,
    assistantSql: pg.assistantSqlLogin,
  });
  login = pg.assistantSqlLogin.user;
  owner = postgres(pg.ownerUrl, { max: 1, onnotice: () => undefined });
  // One connection: every run reuses the same session, as a pooled connection would.
  lane = createAssistantSqlClient(
    withCredentials(pg.ownerUrl, pg.assistantSqlLogin.user, pg.assistantSqlLogin.password),
    1,
  );

  const userA = newId();
  const userB = newId();
  for (const [u, acc] of [
    [userA, accountA],
    [userB, accountB],
  ] as const) {
    await owner`insert into users (id, email, name) values (${u}, ${u + '@example.test'}, 'Owner')`;
    await owner`insert into accounts (id, name, created_by_user_id) values (${acc}, 'Acc', ${u})`;
  }
  await seedBusiness(A1, accountA, userA);
  await seedBusiness(A2, accountA, userA);
  await seedBusiness(A3, accountA, userA, true);
  await seedBusiness(B1, accountB, userB);
});

afterAll(async () => {
  await lane?.close();
  await owner?.end();
  await pg?.stop();
});

const run = (businessIds: string[], sql: string, accountId = accountA, maxRows?: number) =>
  runAssistantSql(lane.sql, {
    accountId,
    businessIds,
    sql,
    ...(maxRows === undefined ? {} : { maxRows }),
  });

async function sqlstate(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AssistantSqlError);
    return (e as AssistantSqlError).sqlstate;
  }
  throw new Error('expected the query to fail');
}

describe('assistant SQL lane: privileges (0059)', () => {
  it('the login holds no privilege on any public relation, and SELECT only on every view', async () => {
    const leaks = await owner`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
        and (has_table_privilege(${login}, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or (c.relkind <> 'S' and has_any_column_privilege(${login}, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))`;
    expect(leaks.map((r) => r['relname'])).toEqual([]);

    const views = await owner`
      select c.relname,
        has_table_privilege(${login}, c.oid, 'SELECT') as sel,
        has_table_privilege(${login}, c.oid, 'INSERT') as ins,
        has_table_privilege(${login}, c.oid, 'UPDATE,DELETE,TRUNCATE') as other
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'assistant_sql' order by 1`;
    expect(views.map((v) => v['relname'])).toEqual(Object.keys(VIEWS).sort());
    for (const v of views) expect([v['sel'], v['ins'], v['other']]).toEqual([true, false, false]);
  });

  it('the login is a member of no other role, and nobody is a member of the reader', async () => {
    for (const role of ['app_tenant', 'app_system', 'app_assistant_reader']) {
      const [r] = await owner`select pg_has_role(${login}, ${role}, 'MEMBER') as m`;
      expect([role, r?.['m']]).toEqual([role, false]);
    }
    const members = await owner`
      select m.roleid::regrole::text as role, m.member::regrole::text as member
      from pg_auth_members m where m.roleid = 'app_assistant_reader'::regrole`;
    expect(members).toEqual([]);
    const [settings] = await owner`
      select r.rolconnlimit, r.rolsuper, r.rolbypassrls, s.setconfig
      from pg_roles r left join pg_db_role_setting s on s.setrole = r.oid and s.setdatabase = 0
      where r.rolname = ${login}`;
    expect(settings?.['rolconnlimit']).toBe(10);
    expect(settings?.['rolsuper']).toBe(false);
    expect(settings?.['rolbypassrls']).toBe(false);
    expect(settings?.['setconfig']).toEqual(
      expect.arrayContaining([
        'default_transaction_read_only=on',
        'statement_timeout=3s',
        'search_path=assistant_sql',
        'idle_in_transaction_session_timeout=5s',
        'temp_file_limit=256MB',
        'work_mem=16MB',
        'track_activities=off',
      ]),
    );
  });

  it('the login runs with those settings and cannot change the superuser-only ones', async () => {
    const direct = postgres(
      withCredentials(pg.ownerUrl, pg.assistantSqlLogin.user, pg.assistantSqlLogin.password),
      { max: 1, onnotice: () => undefined },
    );
    try {
      const [s] = await direct`select current_setting('temp_file_limit') as tfl,
        current_setting('work_mem') as wm, current_setting('track_activities') as ta`;
      expect([s?.['tfl'], s?.['wm'], s?.['ta']]).toEqual(['256MB', '16MB', 'off']);
      for (const stmt of ["set temp_file_limit = '-1'", 'set track_activities = on']) {
        const code = await direct.unsafe(stmt).then(
          () => 'ok',
          (e: { code: string }) => e.code,
        );
        expect([stmt, code]).toEqual([stmt, '42501']);
      }
    } finally {
      await direct.end();
    }
  });

  it("another assistant session cannot read this session's query text", async () => {
    const reader = postgres(
      withCredentials(pg.ownerUrl, pg.assistantSqlLogin.user, pg.assistantSqlLogin.password),
      { max: 1, onnotice: () => undefined },
    );
    const other = createAssistantSqlClient(
      withCredentials(pg.ownerUrl, pg.assistantSqlLogin.user, pg.assistantSqlLogin.password),
      1,
    );
    try {
      const marker = `secret_${newId().slice(0, 8)}`;
      const slow = runAssistantSql(other.sql, {
        accountId: accountA,
        businessIds: [A1],
        sql: `select '${marker}' as m, pg_sleep(1.5)`,
      });
      // Wait until the slow query is running, seen by the owner (a superuser, so it would see the
      // text if the backend published it), then read pg_stat_activity as the login.
      let seen: postgres.Row[] = [];
      for (let i = 0; i < 40 && seen.length === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 25));
        seen = await owner`select pid, state, query from pg_stat_activity
          where usename = ${login} and backend_type = 'client backend' and state = 'disabled'`;
      }
      expect(seen.length).toBeGreaterThan(0);
      const rows = await reader`select pid, state, query from pg_stat_activity
        where usename = ${login} and pid <> pg_backend_pid()`;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(String(r['query'])).not.toContain(marker);
        expect(r['state']).toBe('disabled');
      }
      // Even the superuser sees no text: the session never published it.
      const all =
        await owner`select query from pg_stat_activity where query like ${'%' + marker + '%'}
        and pid <> pg_backend_pid()`;
      expect(all).toEqual([]);
      await slow;
    } finally {
      await reader.end();
      await other.close();
    }
  });

  it('repairs an existing login: grants the group again and revokes any other membership', async () => {
    const reused = { user: `assistant_reused_${newId().slice(0, 8)}`, password: 'x-pass' };
    await owner.unsafe(`create role "${reused.user}" login password 'old' in role app_tenant`);
    await ensureLoginRoles(pg.ownerUrl, {
      tenant: pg.tenantLogin,
      system: pg.systemLogin,
      assistantSql: reused,
    });
    for (const [role, expected] of [
      ['app_assistant_sql', true],
      ['app_tenant', false],
      ['app_system', false],
    ] as const) {
      const [r] = await owner`select pg_has_role(${reused.user}, ${role}, 'MEMBER') as m`;
      expect([role, r?.['m']]).toEqual([role, expected]);
    }
    const [settings] = await owner`
      select r.rolconnlimit, s.setconfig from pg_roles r
      left join pg_db_role_setting s on s.setrole = r.oid and s.setdatabase = 0
      where r.rolname = ${reused.user}`;
    expect(settings?.['rolconnlimit']).toBe(10);
    expect(settings?.['setconfig']).toEqual(
      expect.arrayContaining(['temp_file_limit=256MB', 'track_activities=off']),
    );
    await owner.unsafe(`drop role "${reused.user}"`);
  });

  it('the reader cannot read a PII, note, token or settings column, nor write anything', async () => {
    for (const [table, columns] of Object.entries(NEVER_GRANTED)) {
      for (const column of columns) {
        const [r] = await owner`
          select has_column_privilege('app_assistant_reader', ${'public.' + table}, ${column}, 'SELECT') as p`;
        expect([table, column, r?.['p']]).toEqual([table, column, false]);
      }
    }
    const writable = await owner`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and (has_table_privilege('app_assistant_reader', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
          or has_any_column_privilege('app_assistant_reader', c.oid, 'INSERT,UPDATE'))`;
    expect(writable).toEqual([]);
  });

  it('even a crafted query as the reader itself is refused the phone column', async () => {
    const state = await owner
      .begin(async (tx) => {
        await tx`set local role app_assistant_reader`;
        await tx`select phone from public.contacts`;
      })
      .then(
        () => 'ok',
        (e: { code: string }) => e.code,
      );
    expect(state).toBe('42501');
  });

  it('the views expose exactly the spec columns, in order', async () => {
    const rows = await owner`
      select table_name, array_agg(column_name::text order by ordinal_position) as cols
      from information_schema.columns where table_schema = 'assistant_sql' group by 1`;
    const actual = Object.fromEntries(rows.map((r) => [r['table_name'], r['cols']]));
    expect(actual).toEqual(VIEWS);
  });

  it('every view is a security_barrier view owned by the reader', async () => {
    const rows = await owner`
      select c.relname, pg_get_userbyid(c.relowner) as owner, c.reloptions
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'assistant_sql'`;
    for (const r of rows) {
      expect([r['relname'], r['owner']]).toEqual([r['relname'], 'app_assistant_reader']);
      expect(r['reloptions']).toContain('security_barrier=true');
    }
  });

  it('no SECURITY DEFINER function in public is executable by the login', async () => {
    const rows = await owner`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and has_function_privilege(${login}, p.oid, 'EXECUTE')`;
    expect(rows).toEqual([]);
  });
});

describe('assistant SQL lane: visibility', () => {
  const byBusiness = 'select business_id, count(*) as n from orders group by 1 order by 1';

  it("sees the scope's businesses only", async () => {
    const all = await run([A1, A2], byBusiness);
    expect(all.rows.map((r) => r[0]).sort()).toEqual([A1, A2].sort());
    expect(all.rows.map((r) => r[1])).toEqual([2, 2]);
    const one = await run([A1], byBusiness);
    expect(one.rows.map((r) => r[0])).toEqual([A1]);
  });

  it('a forged business id of another account reads nothing from any view', async () => {
    for (const view of Object.keys(VIEWS)) {
      const r = await run([B1], `select count(*) from ${view}`);
      expect([view, r.rows]).toEqual([view, [[0]]]);
    }
    // Mixed with an own business: only the own one is kept.
    const mixed = await run([A1, B1], byBusiness);
    expect(mixed.rows.map((r) => r[0])).toEqual([A1]);
    // The other account's own id list, under this account: nothing.
    const swapped = await run([B1], byBusiness, accountA);
    expect(swapped.rows).toEqual([]);
  });

  it('evaluates the business filter once per query (InitPlan), not per row', async () => {
    // EXPLAIN has no row count in its command tag, so the runner's cursor drops its rows: plan it
    // as the login from the owner's session instead.
    const plan = await owner.begin(async (tx) => {
      await tx`select set_config('role', ${login}, true),
        set_config('app.account_id', ${accountA}, true),
        set_config('app.assistant_business_ids', ${`{${A1}}`}, true)`;
      return tx.unsafe('explain select count(*) from assistant_sql.order_items');
    });
    const text = plan.map((r) => String(r['QUERY PLAN'])).join('\n');
    expect(text).toContain('InitPlan');
    expect(text).not.toContain('SubPlan');
  });

  it('businesses lists the scope only, never a deleted business', async () => {
    const r = await run([A1, A2, A3], 'select name from businesses order by name');
    expect(r.rows).toEqual([['Shop A1'], ['Shop A2']]);
    const deleted = await run([A3], 'select count(*) from orders');
    expect(deleted.rows).toEqual([[0]]);
  });

  it('alternating accounts on one pooled connection never leaks, and nothing stays set', async () => {
    for (let i = 0; i < 3; i++) {
      const a = await run([A1, A2], 'select distinct business_id from customers order by 1');
      expect(a.rows.map((r) => r[0]).sort()).toEqual([A1, A2].sort());
      const b = await run([B1], 'select distinct business_id from customers', accountB);
      expect(b.rows).toEqual([[B1]]);
    }
    // The same (only) connection outside runAssistantSql: no scope is left behind.
    const [left] = await lane.sql`select
      coalesce(current_setting('app.account_id', true), '') as account,
      coalesce(current_setting('app.assistant_business_ids', true), '') as ids,
      (select count(*) from orders)::int as orders`;
    expect(left).toEqual({ account: '', ids: '', orders: 0 });
  });

  it('a GUC forged inside the query cannot widen the scope to another account', async () => {
    // The guard rejects set_config; this proves the database holds without it. Setting only the
    // business list to B1 under account A keeps nothing.
    const r = await run(
      [A1],
      `select set_config('app.assistant_business_ids', '{${B1}}', true) as s,
              (select count(*) from customers where business_id = '${B1}') as n`,
    );
    expect(r.rows[0]?.[1]).toBe(0);
    // Switching role to the tenant (whose policy reads app.workspace_id) is refused.
    expect(await sqlstate(run([A1], "select set_config('role', 'app_tenant', true)"))).toBe(
      '42501',
    );
    expect(await sqlstate(run([A1], 'set role app_tenant'))).toBe('42501');
  });

  it('customers shows has_phone, never the phone; queries run in Asia/Ho_Chi_Minh', async () => {
    const r = await run(
      [A1],
      "select name, has_phone, current_setting('TimeZone') as tz from customers order by name",
    );
    expect(r.columns).toEqual([
      { name: 'name', type: 'text' },
      { name: 'has_phone', type: 'boolean' },
      { name: 'tz', type: 'text' },
    ]);
    expect(r.rows).toEqual([
      ['Khách A1', true, 'Asia/Ho_Chi_Minh'],
      ['Khách mới A1', false, 'Asia/Ho_Chi_Minh'],
    ]);
    expect(await sqlstate(run([A1], 'select phone from customers'))).toBe('42703');
    expect(await sqlstate(run([A1], 'select * from public.contacts'))).toBe('42501');
    // The JSON customer column is not on the view: its phone key cannot be reached.
    expect(await sqlstate(run([A1], "select customer->>'phone' from orders"))).toBe('42703');
  });

  it('maps column types and cells: numbers, booleans, dates as local text, other as text', async () => {
    const r = await run(
      [A1],
      `select sum(total) as revenue, count(*) as n, avg(total) as avg, bool_or(counts_as_revenue) as b,
              min(placed_at) as at, min(placed_at)::date as day, interval '1 day' as gap,
              9007199254740993::bigint as big
       from orders`,
    );
    expect(r.columns.map((c) => c.type)).toEqual([
      'number',
      'number',
      'number',
      'boolean',
      'date',
      'date',
      'other',
      'number',
    ]);
    const [revenue, n, avg, b, at, day, gap, big] = r.rows[0] ?? [];
    expect([revenue, n, avg, b, gap, big]).toEqual([
      250000,
      2,
      125000,
      true,
      '1 day',
      '9007199254740993',
    ]);
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\+07$/);
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps the columns of an empty result', async () => {
    const r = await run([A1], "select code, total from orders where code = 'none'");
    expect(r).toEqual({
      columns: [
        { name: 'code', type: 'text' },
        { name: 'total', type: 'number' },
      ],
      rows: [],
      truncated: false,
    });
  });

  it('computes revenue, profit and stock as the spec says', async () => {
    const r = await run(
      [A1],
      `select sum(total) filter (where counts_as_revenue) as revenue,
              sum(total) filter (where not is_cancelled) as sales,
              sum(profit) filter (where counts_as_revenue) as profit
       from orders`,
    );
    // 200000 - 90000 cost - 0 discount - (30000 - 20000) shipping borne by the shop.
    expect(r.rows).toEqual([[200000, 200000, 100000]]);
    const stock = await run([A1], 'select stock_on_hand, stock_reserved from product_variants');
    expect(stock.rows).toEqual([[7, 2]]);
    const items = await run(
      [A1],
      'select product_name, sum(qty) from order_items where counts_as_revenue group by 1',
    );
    expect(items.rows).toEqual([['Áo A1', 1]]);
    const stays = await run(
      [A1],
      'select property_name, check_in, nights, adults, children, total_sell, counts_as_revenue from lodging_bookings',
    );
    expect(stays.rows).toEqual([['Villa A1', '2026-11-01', 3, 2, 2, 3000000, true]]);
  });
});

describe('assistant SQL lane: limits', () => {
  it('cannot write: a raw delete fails read-only or denied', async () => {
    expect(['25006', '42501']).toContain(await sqlstate(run([A1], 'delete from orders')));
    expect(['25006', '42501']).toContain(await sqlstate(run([A1], 'delete from public.orders')));
    expect(['25006', '42501']).toContain(
      await sqlstate(run([A1], 'with x as (delete from businesses returning 1) select * from x')),
    );
    expect(['25006', '42501', '25001']).toContain(
      await sqlstate(run([A1], 'set transaction read write')),
    );
    const left = await run([A1], 'select count(*) from orders');
    expect(left.rows).toEqual([[2]]);
  });

  it('times out after about 3 s', async () => {
    const started = Date.now();
    expect(await sqlstate(run([A1], 'select pg_sleep(5)'))).toBe('57014');
    expect(Date.now() - started).toBeLessThan(4_500);
  });

  it('caps the rows at 500 and says so', async () => {
    const capped = await run([A1], 'select g from generate_series(1, 1000) g');
    expect(capped.rows).toHaveLength(500);
    expect(capped.truncated).toBe(true);
    expect(capped.rows[499]).toEqual([500]);
    const exact = await run([A1], 'select g from generate_series(1, 500) g');
    expect([exact.rows.length, exact.truncated]).toEqual([500, false]);
    const small = await run([A1], 'select g from generate_series(1, 5) g', accountA, 3);
    expect([small.rows, small.truncated]).toEqual([[[1], [2], [3]], true]);
    // The connection is usable afterwards (the cursor was closed).
    expect((await run([A1], 'select 1 as one')).rows).toEqual([[1]]);
  });

  it('refuses more than one statement (extended protocol)', async () => {
    expect(await sqlstate(run([A1], 'select 1; select 2'))).toBe('42601');
    expect(await sqlstate(run([A1], 'select 1; delete from orders'))).toBe('42601');
  });

  it('refuses a missing or malformed scope before touching the database', async () => {
    for (const input of [
      { accountId: accountA, businessIds: [] },
      { accountId: '', businessIds: [A1] },
      { accountId: 'not-a-uuid', businessIds: [A1] },
      { accountId: accountA, businessIds: [`${A1}}','{${B1}`] },
      { accountId: accountA, businessIds: [A1, 'x'] },
    ]) {
      await expect(runAssistantSql(lane.sql, { ...input, sql: 'select 1' })).rejects.toThrow(
        'assistant_sql: bad scope',
      );
    }
  });

  it('cannot reach base tables or the catalog secrets', async () => {
    expect(['42501', '42P01']).toContain(await sqlstate(run([A1], 'select * from public.orders')));
    expect(await sqlstate(run([A1], 'select * from pg_catalog.pg_authid'))).toBe('42501');
    expect(await sqlstate(run([A1], 'select * from public.workspaces'))).toBe('42501');
  });
});
