import { describe, expect, it } from 'vitest';

import {
  checkSql,
  MAX_CTES,
  MAX_FROM_ITEMS,
  MAX_SQL_CHARS,
  MAX_STRING_LITERAL_CHARS,
} from '../domain/sql-guard.js';

const views = new Set([
  'businesses',
  'orders',
  'order_items',
  'products',
  'product_variants',
  'customers',
  'conversations',
  'channels',
  'bots',
  'activity_events',
  'lodging_bookings',
]);
const check = (sql: string) => checkSql(sql, { views });

describe('checkSql: accepted', () => {
  const accepted: [string, string, string[]][] = [
    [
      'revenue this week',
      "select sum(total) from orders where counts_as_revenue and placed_at >= date_trunc('week', now())",
      ['orders'],
    ],
    [
      'a CTE joined to a view',
      'with t as (select business_id, sum(total) as revenue from orders group by 1) ' +
        'select b.name, t.revenue from t join businesses b on b.business_id = t.business_id',
      ['orders', 't', 'businesses'],
    ],
    [
      'two CTEs',
      'with a as (select 1 as n), b as materialized (select n from a) select * from b',
      ['a', 'b'],
    ],
    [
      'an aggregate filter',
      "select count(*) filter (where status = 'delivered') from orders",
      ['orders'],
    ],
    [
      'a window',
      'select business_id, d, sum(x) over (partition by business_id order by d) ' +
        'from (select business_id, placed_at::date as d, total as x from orders) q',
      ['orders'],
    ],
    [
      'extract … from inside a call',
      'select extract(dow from placed_at) as dow, count(*) from orders group by 1',
      ['orders'],
    ],
    [
      'interval and current_date arithmetic',
      "select count(*) from orders where placed_at >= now() - interval '7 days' " +
        'and placed_at::date > current_date - 7',
      ['orders'],
    ],
    ['a cast to date', 'select placed_at::date, count(*) from orders group by 1', ['orders']],
    [
      'Vietnamese inside a string',
      "select product_name from order_items where product_name ilike '%áo%'",
      ['order_items'],
    ],
    [
      'generate_series of typed literals',
      "select d::date from generate_series(date '2026-11-01', date '2026-11-07', interval '1 day') d",
      [],
    ],
    [
      'generate_series joined to a view',
      "select d::date, count(o.order_id) from generate_series(date '2026-11-01', date '2026-11-07', interval '1 day') d " +
        'left join orders o on o.placed_at::date = d::date group by 1 order by 1',
      ['orders'],
    ],
    ['a trailing semicolon', 'select count(*) from customers;', ['customers']],
    ['surrounding whitespace', '  \n select 1 ;  \n', []],
    [
      'a top 5 ranking',
      'select product_name, sum(qty) as sold from order_items where counts_as_revenue ' +
        'group by 1 order by 2 desc limit 5',
      ['order_items'],
    ],
    [
      'a scalar subquery and coalesce',
      'select coalesce((select sum(total) from orders where counts_as_revenue), 0) as revenue',
      ['orders'],
    ],
    [
      'case, in, between, is distinct from',
      "select case when status in ('delivered', 'delivering') then 'ok' else 'other' end, count(*) " +
        "from orders where total between 0 and 100000 and source is distinct from 'pos' group by 1",
      ['orders'],
    ],
    [
      'exists with a correlated subquery',
      'select count(*) from customers c where exists (select 1 from orders o where o.business_id = c.business_id)',
      ['customers', 'orders'],
    ],
    [
      'union of two views',
      'select name from products union all select name from bots',
      ['products', 'bots'],
    ],
    [
      'a typed cast with a modifier and double precision',
      'select round(avg(total)::numeric(14, 2), 0), sum(total)::double precision from orders',
      ['orders'],
    ],
    [
      'string helpers, to_char and at time zone',
      "select to_char(placed_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM') as m, " +
        "lower(trim(both ' ' from customer_name)) from orders",
      ['orders'],
    ],
    [
      'negative numbers next to an operator',
      'select count(*) from orders where remaining>-1 and paid=-0',
      ['orders'],
    ],
    ['upper-case keywords', 'SELECT COUNT(*) FROM Orders WHERE Total > 1e3', ['orders']],
    [
      'a percentile within group',
      'select percentile_cont(0.5) within group (order by total) from orders',
      ['orders'],
    ],
  ];

  it.each(accepted)('%s', (_name, sql, relations) => {
    const result = check(sql);
    expect(result).toEqual({ ok: true, sql: expect.any(String), relations });
  });

  it('returns the trimmed SQL without the trailing semicolon, unchanged otherwise', () => {
    expect(check('  select  Total from orders ;  ')).toEqual({
      ok: true,
      sql: 'select  Total from orders',
      relations: ['orders'],
    });
  });
});

describe('checkSql: rejected', () => {
  const rejected: [string, string][] = [
    // Statements other than one SELECT.
    ['select 1; delete from orders', 'multiple_statements'],
    ['select 1;;', 'multiple_statements'],
    ['delete from orders', 'not_select'],
    ['update orders set total = 0', 'not_select'],
    ['with x as (delete from orders returning 1) select 1', 'keyword:delete'],
    ['with x as (update orders set total = 0 returning 1) select 1', 'keyword:update'],
    ['with x as (insert into orders values (1) returning 1) select 1', 'keyword:insert'],
    ['select * into t from orders', 'keyword:into'],
    ['select * from orders for update', 'keyword:for'],
    ['table orders', 'not_select'],
    ['explain select 1', 'not_select'],
    ['(select 1)', 'not_select'],
    ['', 'not_select'],
    ['with recursive r as (select 1) select * from r', 'keyword:recursive'],
    [
      'with orders as (select 1 n) select (with recursive orders as ' +
        '(select 1 n union all select n+1 from orders) select count(*) from orders)',
      'keyword:recursive',
    ],
    ['select 1 from orders o where exists (select 1 from only orders)', 'keyword:only'],
    ['select * from orders tablesample system (10)', 'keyword:tablesample'],
    // Catalogs, schemas and session identity.
    ['select * from pg_class', 'catalog:pg_class'],
    ['select * from pg_catalog.pg_roles', 'catalog:pg_catalog'],
    ['select * from information_schema.tables', 'keyword:information_schema'],
    ['select * from public.orders', 'keyword:public'],
    ['select * from assistant_sql.orders', 'keyword:assistant_sql'],
    ['select current_user', 'keyword:current_user'],
    ['select session_user, 1', 'keyword:session_user'],
    ['select user', 'keyword:user'],
    ['select system_user', 'keyword:system_user'],
    ['select current_catalog', 'keyword:current_catalog'],
    ['select current_schema', 'keyword:current_schema'],
    // GUCs and functions that run SQL, sleep or lock.
    ["select current_setting('app.account_id')", 'function_not_allowed:current_setting'],
    [
      "select set_config('app.assistant_business_ids','{}',true)",
      'function_not_allowed:set_config',
    ],
    ["set app.account_id = '1'", 'not_select'],
    ['select 1 from orders where 1 = (select 1 from orders) and reset = 1', 'keyword:reset'],
    ["select query_to_xml('select 1',true,true,'')", 'function_not_allowed:query_to_xml'],
    ['select pg_sleep(10)', 'function_not_allowed:pg_sleep'],
    ['select pg_advisory_lock(1)', 'function_not_allowed:pg_advisory_lock'],
    ["select pg_notify('a', 'b')", 'function_not_allowed:pg_notify'],
    ["select dblink('x', 'select 1')", 'function_not_allowed:dblink'],
    ['select lo_import(1)', 'function_not_allowed:lo_import'],
    ['select version()', 'function_not_allowed:version'],
    ['select count(*) from orders where txid_current() > 0', 'function_not_allowed:txid_current'],
    // Casts and typed literals.
    ["select 'orders'::regclass", 'type_not_allowed:regclass'],
    ["select 'x'::oid", 'type_not_allowed:oid'],
    ['select 1::double', 'type_not_allowed:double'],
    ["select regclass 'orders'", 'typed_literal:regclass'],
    ["select int '1'", 'typed_literal:int'],
    ['select cast(1 as int)', 'function_not_allowed:cast (use ::type)'],
    // Comments, dollar quotes, prefixed strings, quoted identifiers.
    ['select 1 -- x', 'comment'],
    ['select /* x */ 1', 'comment'],
    ['select 1 +-- x\n 1', 'comment'],
    ['select $$x$$', 'dollar'],
    ['select $1', 'dollar'],
    ["select E'\\x41'", 'string_prefix'],
    ["select e'a'", 'string_prefix'],
    ["select U&'d\\0062t'", 'string_prefix'],
    ["select X'1F'", 'string_prefix'],
    ['select "Orders".total from orders', 'quoted_identifier'],
    ["select 'unterminated", 'syntax'],
    ['select 0x1f', 'syntax'],
    // Operators.
    ['select x.lower(name) from customers x', 'qualified_function'],
    ['select 1 ~ 2', 'operator:~'],
    ["select name from customers where name ~* 'a'", 'operator:~*'],
    ['select 1 from orders where total @> 1', 'operator:@>'],
    ['select a[1] from orders', 'operator:['],
    ['select x:y', 'operator::'],
    ['select 1 # 2', 'operator:#'],
    // Strings that grow (final review C1): no concatenation, no string-building function.
    ["select customer_name || 'x' from orders", 'operator:||'],
    ["select 'a'||'b'", 'operator:||'],
    ["select concat(customer_name, 'x') from orders", 'function_not_allowed:concat'],
    ["select replace(customer_name, 'a', 'aaaa') from orders", 'function_not_allowed:replace'],
    ["select repeat('x', 1000000)", 'function_not_allowed:repeat'],
    ["select lpad('x', 1000000, 'y')", 'function_not_allowed:lpad'],
    ["select rpad('x', 1000000)", 'function_not_allowed:rpad'],
    ["select string_agg(customer_name, ',') from orders", 'function_not_allowed:string_agg'],
    ['select array_agg(total) from orders', 'function_not_allowed:array_agg'],
    ["select format('%s%s', 'a', 'b')", 'function_not_allowed:format'],
    ["select overlay('a' placing 'bbb' from 1)", 'function_not_allowed:overlay'],
    ["select translate('a', 'a', 'b')", 'function_not_allowed:translate'],
    [`select '${'x'.repeat(MAX_STRING_LITERAL_CHARS - 1)}'`, 'string_too_long'],
    // Shape.
    ['select 1) union (select 2', 'unbalanced'],
    ['select (1', 'unbalanced'],
    [`select ${'('.repeat(11)}1${')'.repeat(11)}`, 'too_deep'],
    [`select ${Array.from({ length: 600 }, () => '1').join(',')}`, 'too_long'],
    // Relations.
    ['select * from users', 'unknown_view:users'],
    ['select * from orders o join accounts a on true', 'unknown_view:accounts'],
    ['select * from orders where order_id in (select id from secrets)', 'unknown_view:secrets'],
    ['select * from orders, lateral unaccent(name)', 'function_not_allowed:unaccent'],
    // Characters.
    ['select tên from customers', 'bad_chars'],
    ['select 1', 'bad_chars'],
    ['select 1\u0000', 'bad_chars'],
    ["select 'a\u0007'", 'bad_chars'],
    [`select ${'1+'.repeat((MAX_SQL_CHARS - 6) / 2)}1`, 'too_long'],
  ];

  it.each(rejected)('%s → %s', (sql, reason) => {
    expect(check(sql)).toEqual({ ok: false, reason });
  });

  it('rejects the exploding-CTE pattern of the final review (C1)', () => {
    const levels = Array.from(
      { length: 12 },
      (_, i) => `a${i + 1} as (select ${Array(10).fill('s').join('||')} s from a${i})`,
    );
    const exploding = `with a0 as (select '${'x'.repeat(1000)}' s), ${levels.join(', ')} select length(s) from a12`;
    expect(exploding.length).toBeLessThan(MAX_SQL_CHARS);
    expect(check(exploding).ok).toBe(false);
    // Each part is refused on its own: the long literal, and the concatenation.
    expect(check(exploding.replace('x'.repeat(1000), 'x'))).toEqual({
      ok: false,
      reason: 'operator:||',
    });
    expect(check(`with a0 as (select '${'x'.repeat(1000)}' s) select s from a0`)).toEqual({
      ok: false,
      reason: 'string_too_long',
    });
  });

  it('caps string literals at 200 chars, quotes included', () => {
    const at = `'${'x'.repeat(MAX_STRING_LITERAL_CHARS - 2)}'`;
    expect(check(`select ${at}`).ok).toBe(true);
    expect(check(`select '${'x'.repeat(MAX_STRING_LITERAL_CHARS - 1)}'`)).toEqual({
      ok: false,
      reason: 'string_too_long',
    });
  });

  it(`caps the CTEs at ${MAX_CTES}`, () => {
    const ctes = (n: number) =>
      `with ${Array.from({ length: n }, (_, i) => `c${i} as (select ${i} as n)`).join(', ')} select 1`;
    expect(check(ctes(MAX_CTES)).ok).toBe(true);
    expect(check(ctes(MAX_CTES + 1))).toEqual({ ok: false, reason: 'too_many_ctes' });
  });

  it(`caps the FROM / JOIN items at ${MAX_FROM_ITEMS}, comma-joined ones included`, () => {
    const names = [...views].slice(0, MAX_FROM_ITEMS + 1);
    const commas = (n: number) => `select count(*) from ${names.slice(0, n).join(', ')}`;
    expect(check(commas(MAX_FROM_ITEMS)).ok).toBe(true);
    expect(check(commas(MAX_FROM_ITEMS + 1))).toEqual({ ok: false, reason: 'too_many_relations' });
    const joins = (n: number) =>
      `select count(*) from orders o0 ${Array.from({ length: n - 1 }, (_, i) => `join orders o${i + 1} on true`).join(' ')}`;
    expect(check(joins(MAX_FROM_ITEMS)).ok).toBe(true);
    expect(check(joins(MAX_FROM_ITEMS + 1))).toEqual({ ok: false, reason: 'too_many_relations' });
    // Items in subqueries and CTEs count towards the same total.
    expect(
      check(
        'with a as (select 1 n from orders, customers, products) ' +
          'select count(*) from a, orders, (select 1 from customers, bots) s',
      ),
    ).toEqual({ ok: false, reason: 'too_many_relations' });
  });

  it('checks every comma-joined FROM item against the views', () => {
    expect(check('select 1 from orders, secrets')).toEqual({
      ok: false,
      reason: 'unknown_view:secrets',
    });
    expect(check('select 1 from orders o, lateral x')).toEqual({
      ok: false,
      reason: 'unknown_view:lateral',
    });
    // Commas outside a FROM list are not items.
    expect(
      check(
        'select a, b from (select 1 a, 2 b) s, orders where total in (1, 2) group by a, b ' +
          'order by a, b',
      ).ok,
    ).toBe(true);
  });

  it('allows one generate_series call per query', () => {
    const cross = (n: number) =>
      `select count(*) from ${Array.from({ length: n }, (_, i) => `generate_series(1,300000) a${i}`).join(', ')}`;
    expect(check(cross(1)).ok).toBe(true);
    expect(check(cross(60))).toEqual({ ok: false, reason: 'too_many_generate_series' });
    expect(check(cross(2))).toEqual({ ok: false, reason: 'too_many_generate_series' });
    expect(check('select generate_series(1,3), generate_series(1,3)')).toEqual({
      ok: false,
      reason: 'too_many_generate_series',
    });
  });

  it('measures the length after trimming: 4 000 chars pass the length rule, 4 001 do not', () => {
    const at = `select 1 from orders where 1 = 1${' '.repeat(MAX_SQL_CHARS - 34)}+1`;
    expect(at.length).toBe(MAX_SQL_CHARS);
    expect(check(at).ok).toBe(true);
    expect(check(`${at}1`)).toEqual({ ok: false, reason: 'too_long' });
  });
});
