# Owner assistant capability 2: data questions, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner asks number questions ("doanh thu tuần này", "top 5 sản phẩm bán chạy tháng trước", "bao nhiêu khách mới từ Facebook"). The assistant answers from a read-only SQL lane over curated views and can show a small chart in the bubble.

**Architecture:**

- **Database.** Migration 0060 adds:
  - schema `assistant_sql` with 11 `security_barrier` views, owned by a NOLOGIN `app_assistant_reader`;
  - column-level grants and `FOR SELECT` RLS policies for the reader, through `assistant_sql_business_ids()`, which checks `app.account_id` together with `app.assistant_business_ids`;
  - a group role `app_assistant_sql` with `SELECT` on the views only. A dedicated login (`DATABASE_ASSISTANT_SQL_URL`) belongs to it.
- **`packages/db`** runs one query per `READ ONLY` transaction with transaction-local GUCs, a 3 s statement timeout and a 501-row cursor.
- **Backend.** The assistant module gets:
  - a pure SQL guard in `domain/`;
  - a runner port with a Postgres adapter;
  - two native entries (`sql_schema`, `sql_query`) in the deferred catalog, reached through `tool_search` / `tool_describe` / `tool_call`;
  - a chart builder that turns query rows into a `chart` UI action.
- **Web.** The bubble renders `chart` actions with recharts through `components/ui/chart.tsx`.

**Tech Stack:** NestJS 12 on Fastify, PostgreSQL 16 (RLS, column grants, `security_barrier` views), postgres.js, Drizzle (unchanged tables), Zod 4, Vitest, React 19, recharts 3.10.1 (already in `apps/web`), i18next.

**Spec:** `docs/superpowers/specs/2026-11-02-owner-assistant-data-questions-design.md`. Parent: `docs/superpowers/specs/2026-11-02-owner-assistant-core-design.md` (§1, §3, §6, §18, §19). ADRs: `docs/adr/ADR-024-owner-assistant.md`, `docs/adr/ADR-004-multi-tenant-rls.md`.

**Precondition:** start from `main` after the 1c PR (migration 0059, `assistant_settings.disabled_toolsets`) is merged. If 1c is not merged yet, branch from its branch and rebase later; the toolset step in Task 3 is the only part that touches 1c code.

## Global Constraints

- Everything in the 1b and 1c Global Constraints still applies:
  - owners only (`resolveOwnerScope`, 403 for everyone else);
  - no prompt, memory, skill or tool-argument text in logs;
  - `pnpm check` passes at the end of every task;
  - never skip or delete a test.
- **The SQL lane never writes.** Four layers enforce this, and each must hold alone:
  1. the guard (one `SELECT`/`WITH`);
  2. the login's grants (`SELECT` on `assistant_sql` views only);
  3. a `READ ONLY` transaction plus `default_transaction_read_only` on the login;
  4. no write grant for `app_assistant_reader`.
- **Visibility** = `scope.businessIds` (or a subset the model names) ∩ businesses of the owner's account. It is enforced by the reader's RLS policies, not only by our code.
- **No PII columns** in any view: no phone, email, address, birthday, gender, free-text notes, message text, tokens, settings, external ids or staff names. Names of customers, guests, products, bots, channels and businesses are allowed.
- **Limits:** statement_timeout 3 s; lock_timeout 1 s; idle_in_transaction_session_timeout 5 s; work_mem 16 MB; at most 500 rows (501 fetched to detect truncation); result to the model ≤ 8 000 chars; ≤ 8 `sql_query` calls and ≤ 3 charts per turn; SQL text ≤ 4 000 chars.
- **Logs and steps carry no SQL text and no rows**, only the run id, `sqlstate` and error class.
- New migration: `0060_assistant_sql.sql`. It is additive, idempotent where roles are concerned (`DO $$ … IF NOT EXISTS … $$`), and touches no existing column.
- No new runtime dependency. The repo has no SQL parser, so the guard is hand-written (Ruling 2-R2).
- Commit messages: Conventional Commits, scope `assistant`, `db`, `contracts`, `web`, `ai-core` or `infra`, ending with `(T-171)`, then a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings taken while planning (owner unavailable)

- **2-R1:** The SQL lane connects with its **own login** (`rapiz_assistant` ∈ `app_assistant_sql`), not with `SET LOCAL ROLE` from the tenant login. The reason: `RESET ROLE` or `set_config('role', …)` would return to `app_tenant`, which can read any workspace by setting `app.workspace_id`. Cost if wrong: one more secret and deploy step, and a second pool (max 4).
- **2-R2:** No SQL parser dependency. The guard is a lexer with keyword, function and type allow-lists, and the database privileges are the real boundary. Cost if wrong: some valid SQL is rejected (quoted identifiers, `CAST(…)`, `substring(x from 1 for 3)`); the model gets a readable error and rewrites the query.
- **2-R3:** The views are owned by a NOLOGIN `app_assistant_reader`. It has column-level grants and one `FOR SELECT` policy per base table: `workspace_id = ANY ((SELECT assistant_sql_business_ids()))`. The function keeps only ids that are in `app.assistant_business_ids` and belong to `app.account_id`, so a forged id list alone reads nothing. Cost if wrong: 15 extra policies; a migration that changes a column a view reads must recreate the view.
- **2-R4:** Customer phone, email, address, birthday and gender, recipients, notes and message text are not exposed; names are. `customers.has_phone` is a boolean from `phone_provided_at`. Cost if wrong: the owner cannot pull phone lists through the assistant (the assistant can open `/app/customers` instead).
- **2-R5:** `sql_schema` and `sql_query` are native entries of the deferred catalog (core spec §6), run through `tool_call({key, body})`. The always-loaded tool list and the `assistant@2` prompt are unchanged, and a new platform skill teaches the flow. Cost if wrong: one extra hop; run steps show `tool_call`, and 1c's usage counter counts SQL calls under `routes`.
- **2-R6:** Charts are built only from `sql_query` rows (the `chart` argument), never from numbers the model types. The chart rows are stored in the message's `ui_actions` (aggregates on an account-scoped RLS row, as 1b-R10). Cost if wrong: no charts from route-tool results.
- **2-R7:** The row cap uses a postgres.js cursor (`tx.unsafe(sql).cursor(501)`, first batch only), so the model's `ORDER BY` holds and its SQL runs unchanged. If the cursor is not usable on `unsafe` in the installed postgres.js, fall back to `SELECT * FROM (\n<sql>\n) AS assistant_q LIMIT 501` (safe because the guard requires balanced parentheses and rejects `;` and comments). Record which one was used in the spec's adjustments section.
- **2-R8:** Every query runs with `TimeZone = Asia/Ho_Chi_Minh`, whatever the business's `timezone` (the same zone as the assistant's prompt date). Cost if wrong: day edges are off for a business in another zone.
- **2-R9:** For lodging, `counts_as_revenue` = `kind = 'stay'` and status in (`confirmed`, `checked_in`, `checked_out`). `total_sell` and `adjustment` stay separate columns. This has not been verified against a dashboard figure, and a later view migration can change it.
- **2-R10:** The lane runs in the `api` process only (the synchronous turn), on the primary. Cost if wrong: capability 3 (schedules) must wire the runner into the worker. A read replica needs only a different URL.
- **2-R11:** The owner never sees the SQL text, and it is never stored in steps or logs. Cost if wrong: the owner cannot audit the query; the chart's "Xem bảng" shows the rows.
- **2-R12:** ADR-004 gets an amendment and ADR-024 a consequence line in this PR, because rule 05 requires an ADR for a tenant-model change. The PR body flags this for the maintainer (rule 08: ADR files change only when a human asks). Cost if wrong: the maintainer asks for a separate ADR.

---

### Task 1: Contracts (chart UI action) and the SQL guard

**Files:**
- Modify: `packages/contracts/src/assistant/assistant.schema.ts` and its test file (find it next to the schema or under `packages/contracts/src/assistant/`).
- Create: `apps/backend/src/modules/assistant/domain/sql-guard.ts` and `apps/backend/src/modules/assistant/__tests__/sql-guard.spec.ts`.
- Modify: `apps/web/src/features/assistant/components/assistant-panel.tsx`. In `apply()`, the last branch is currently a bare `else` that treats every other action as `fill_form`. Make it `else if (action.type === 'fill_form')` so a `chart` action is ignored. Update the doc comment and add a test in `assistant-panel.test.tsx`: an answer with a `chart` action neither navigates nor fills.

**Contracts (produced):**

```ts
export const AssistantChartUnit = z.enum(['vnd', 'count', 'percent', 'number']);
export const AssistantChart = z.object({
  kind: z.enum(['bar', 'line', 'pie']),
  title: z.string().max(120),
  x: z.object({ key: z.string().max(63), label: z.string().max(60) }),
  series: z.array(z.object({ key: z.string().max(63), label: z.string().max(60) })).min(1).max(4),
  unit: AssistantChartUnit,
  rows: z
    .array(z.record(z.string().max(63), z.union([z.string().max(80), z.number(), z.null()])))
    .max(60),
});
export type AssistantChart = z.infer<typeof AssistantChart>;
// AssistantUiAction gains:
z.object({ type: z.literal('chart'), chart: AssistantChart })
```

- A pie chart has exactly one series and at most 12 rows; check this with `.superRefine` on `AssistantChart`.
- The variant is additive: older messages still parse.

**Guard (produced):**

```ts
export type SqlGuardResult =
  | { ok: true; sql: string; relations: string[] }
  | { ok: false; reason: string };            // e.g. 'function_not_allowed:pg_sleep'
export interface SqlGuardOptions { views: ReadonlySet<string> }
export const MAX_SQL_CHARS = 4_000;
export function checkSql(text: string, opts: SqlGuardOptions): SqlGuardResult;
```

Rules (spec §7), in this order:

1. Trim, then strip one trailing `;`.
   - `> MAX_SQL_CHARS` → `too_long`.
   - Control characters (except `\n \r \t`) → `bad_chars`.
   - Non-ASCII outside string literals → `bad_chars`.
2. Lex into identifiers `[A-Za-z_][A-Za-z0-9_]*` (folded to lower case), numbers, `'…'` strings (`''` escape; unterminated → `syntax`), and operators. Reject:
   - `--` / `/*` → `comment`;
   - `$` → `dollar`;
   - `"` → `quoted_identifier`;
   - a string prefix (`e`, `u&`, `b`, `x`, `n` directly before `'`) → `string_prefix`;
   - any `;` → `multiple_statements`;
   - an operator outside `= <> != < > <= >= + - * / % || ( ) , . ::` → `operator:<op>`.
3. The first token must be `select` or `with` (`not_select`). `with recursive` → `recursive`.
4. Denied words → `keyword:<w>`:
   - `insert update delete merge into copy create alter drop grant revoke truncate set reset lock for call do execute prepare deallocate listen notify unlisten vacuum analyze explain refresh cluster reindex checkpoint load import discard declare fetch move close cursor returning table only tablesample current_user session_user current_role user public assistant_sql information_schema`;
   - any identifier starting with `pg_` → `catalog:<w>`.
5. Function calls (identifier + `(`) that are not one of the keywords below → `function_not_allowed:<name>` unless allow-listed.
   - Keywords that take parentheses: `in exists any all some over filter as values using on and or not select from where join when then else case by having union intersect except between is like ilike distinct within group partition`.
   - Allow-list:
     - aggregates: `count sum avg min max bool_and bool_or every percentile_cont percentile_disc mode`;
     - window functions: `row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value`;
     - math: `round trunc floor ceil ceiling abs greatest least`;
     - null handling: `coalesce nullif`;
     - dates: `date_trunc date_part extract to_char make_date make_interval age now generate_series`;
     - strings: `lower upper length btrim trim ltrim rtrim substr replace concat left right split_part initcap position`.
   - `cast(` → `function_not_allowed:cast (use ::type)`.
   - A call after `.` → `qualified_function`.
6. After `::`, the next one or two tokens must form an allowed type → `type_not_allowed:<t>`:
   - `date timestamp timestamptz time interval numeric decimal int integer bigint smallint real float text varchar boolean bool`, and `double precision`.
   - An identifier directly followed by a string literal is a typed literal. It is allowed only for `date timestamp timestamptz time interval` → `typed_literal:<t>`.
7. Relations:
   - Collect CTE names: the identifiers right before `as (` at depth 0 after `with`, and after each comma that follows a closed CTE body.
   - An identifier right after `from` or `join` must be in `opts.views`, a CTE name, or the token must be `(` → `unknown_view:<name>`.
   - The function returns the distinct relation names it saw.
8. Parentheses must balance (`unbalanced`), depth ≤ 10 (`too_deep`), tokens ≤ 1 000 (`too_long`).

**Tests** (`sql-guard.spec.ts`, table-driven, at least 40 cases). Accepted:
- `select sum(total) from orders where counts_as_revenue and placed_at >= date_trunc('week', now())`
- a `with t as (…) select … from t join businesses b on …`
- `count(*) filter (where …)`
- `sum(x) over (partition by business_id order by d)`
- `extract(dow from placed_at)`
- `interval '7 days'` and `current_date - 7`
- `placed_at::date`
- `name ilike '%áo%'` (Vietnamese inside a string)
- `generate_series(date '2026-11-01', date '2026-11-07', interval '1 day')`
- a trailing `;`

Rejected (assert the reason):
- `select 1; delete from orders`
- `delete from orders`
- `with x as (delete from orders returning 1) select 1`
- `select * into t from orders`
- `select * from orders for update`
- `table orders`
- `explain select 1`
- `with recursive …`
- `select * from pg_class`, `select * from pg_catalog.pg_roles`, `select * from information_schema.tables`, `select * from public.orders`
- `select current_setting('app.account_id')`
- `select set_config('app.assistant_business_ids','{}',true)`
- `select query_to_xml('select 1',true,true,'')`
- `select pg_sleep(10)`, `select pg_advisory_lock(1)`
- `select 'orders'::regclass`, `select regclass 'orders'`
- `select cast(1 as int)`
- `select 1 -- x`, `select /* x */ 1`
- `select $$x$$`, `select E'\x41'`, `select "Orders".total from orders`
- `select x.lower(name) from customers x`
- `select 1) union (select 2`
- an unknown view `select * from users`
- `select * from orders, lateral unaccent(name)`
- a non-ASCII identifier
- 4 001 chars

**Steps:**
- [ ] Write the contract tests (chart variant parses; a pie with 2 series fails; 61 rows fails) and the guard tests. Run `pnpm --filter @agent-sales/contracts test` and `pnpm --filter @agent-sales/backend test -- sql-guard`, and see them fail.
- [ ] Implement the contract, the guard and the web `apply()` fix.
- [ ] Run `pnpm --filter @agent-sales/contracts test build`, `pnpm --filter @agent-sales/backend test -- assistant`, `pnpm --filter @agent-sales/web test typecheck`, then `pnpm check`.
- [ ] Commit `feat(assistant): add the SQL guard and the chart UI action contract (T-171)`.

### Task 2: Database — migration 0060, the SQL runner helper and the login

**Files:**
- Create: `packages/db/migrations/0060_assistant_sql.sql`, `packages/db/src/assistant-sql.ts`, `packages/db/src/assistant-sql.integration.test.ts`
- Modify: `packages/db/src/index.ts` (exports), `packages/db/src/migrate.ts` (`ensureLoginRoles` takes an optional `assistantSql` login), `packages/db/src/cli/migrate.ts` (read `DATABASE_ASSISTANT_SQL_URL` when set), `packages/testing/src/postgres.ts` (`assistantSqlLogin: { user: 'rapiz_assistant', password: 'assistant_test' }`), `packages/db/README.md` (roles and allowed processes)

**Migration 0060** (one file, in this order):

1. Roles, created only if missing:
   - `app_assistant_reader NOLOGIN`;
   - `app_assistant_sql NOLOGIN`.
2. `CREATE SCHEMA IF NOT EXISTS assistant_sql`, then `REVOKE ALL ON SCHEMA assistant_sql FROM PUBLIC`.
3. Grants for the reader:
   - `GRANT USAGE ON SCHEMA public TO app_assistant_reader`;
   - column-level `GRANT SELECT (…)` on exactly the columns the views read (spec §4.4). The tables are `workspaces, orders, order_items, product_variants, products, inventory, contacts, crm_sources, crm_statuses, conversations, channel_connections, bots, analytics_facts, lodging_bookings, lodging_properties`.
   - Never grant: `contacts.phone, phone_normalized, email, email_normalized, birthday, gender, address, ward, profile_note`; `orders.recipient, note_internal, note_print, created_by_name, tracking_code`; `conversations.customer_id, customer_phone, data`; `channel_connections.token_sealed, external_id, settings`; `bots.settings`; `lodging_bookings.guest_phone, note, quote`.
4. `assistant_sql_business_ids()`:

   ```sql
   CREATE OR REPLACE FUNCTION assistant_sql_business_ids() RETURNS uuid[]
     LANGUAGE sql STABLE SECURITY INVOKER PARALLEL SAFE
     SET search_path = public
     AS $$
       SELECT coalesce(array_agg(w.id), '{}'::uuid[]) FROM workspaces w
       WHERE w.id = ANY (nullif(current_setting('app.assistant_business_ids', true), '')::uuid[])
         AND w.account_id = nullif(current_setting('app.account_id', true), '')::uuid
         AND w.deleted_at IS NULL
     $$;
   REVOKE ALL ON FUNCTION assistant_sql_business_ids() FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION assistant_sql_business_ids() TO app_assistant_reader;
   ```

5. Policies, each with `DROP POLICY IF EXISTS` first. Name them `<table>_assistant_reader`, `FOR SELECT TO app_assistant_reader`:
   - on `workspaces`: `USING (id = ANY (nullif(current_setting('app.assistant_business_ids', true), '')::uuid[]) AND account_id = (SELECT nullif(current_setting('app.account_id', true), '')::uuid) AND deleted_at IS NULL)`;
   - on the 14 other tables: `USING (workspace_id = ANY ((SELECT assistant_sql_business_ids())))`.

   No `WITH CHECK` (select only).
6. Views: `CREATE OR REPLACE VIEW assistant_sql.<name> WITH (security_barrier = true) AS …`, exactly the columns of spec §4.3, in that order.
   - Join on both keys (`x.workspace_id = y.workspace_id AND x.id = y.<fk>`).
   - `orders.counts_as_revenue` uses the literal list `('confirmed','packing','awaiting_print','printed','awaiting_handover','delivering','delivered')`, with a comment that it mirrors `CLOSED_ORDER_STATUSES`. `profit` is `subtotal - cost_total - discount_amount - (shipping_fee - shipping_fee_charged)`.
   - `lodging_bookings.nights` is `check_out - check_in`, and `children` is `cardinality(child_ages)`.
   - `product_variants.stock_on_hand` / `stock_reserved` are `coalesce((SELECT sum(i.on_hand) FROM inventory i WHERE i.workspace_id = v.workspace_id AND i.variant_id = v.id), 0)` (and the same for `reserved`).
7. View ownership:
   - `GRANT CREATE ON SCHEMA assistant_sql TO app_assistant_reader`;
   - `ALTER VIEW assistant_sql.<each> OWNER TO app_assistant_reader`;
   - `REVOKE CREATE ON SCHEMA assistant_sql FROM app_assistant_reader`.

   The migration runs as `rapiz_owner`, a superuser in `infra/deploy/compose.yml` and in the test container. Add a header comment that a non-superuser migrator needs `GRANT app_assistant_reader TO <migrator>` first.
8. `GRANT USAGE ON SCHEMA assistant_sql TO app_assistant_sql`, then `GRANT SELECT ON ALL TABLES IN SCHEMA assistant_sql TO app_assistant_sql`.

**`ensureLoginRoles`:** add an optional `assistantSql` login, created `IN ROLE app_assistant_sql` with `CONNECTION LIMIT 10`. Then always run:

```sql
ALTER ROLE <login> SET default_transaction_read_only = on;
ALTER ROLE <login> SET statement_timeout = '3s';
ALTER ROLE <login> SET search_path = assistant_sql;
ALTER ROLE <login> SET idle_in_transaction_session_timeout = '5s';
```

Refuse (throw) if the login name equals the tenant or system login. The CLI passes it only when `DATABASE_ASSISTANT_SQL_URL` is set, and prints it in the "login roles ensured" line.

**`assistant-sql.ts` (produced):**

```ts
export type AssistantSqlClient = postgres.Sql;
export function createAssistantSqlClient(url: string, max = 4): { sql: AssistantSqlClient; close(): Promise<void> };
export interface AssistantSqlColumn { name: string; type: 'number' | 'text' | 'boolean' | 'date' | 'other' }
export interface AssistantSqlResult {
  columns: AssistantSqlColumn[];
  rows: (string | number | boolean | null)[][];
  truncated: boolean;
}
export class AssistantSqlError extends Error { constructor(readonly sqlstate: string, message: string) }
export const ASSISTANT_SQL_TIMEZONE = 'Asia/Ho_Chi_Minh';
export async function runAssistantSql(
  client: AssistantSqlClient,
  input: { accountId: string; businessIds: readonly string[]; sql: string; maxRows?: number /* 500 */ },
): Promise<AssistantSqlResult>;
```

**The client:**
- `postgres(url, { max, prepare: false, connection: { application_name: 'rapiz-assistant-sql' }, types: … })`;
- date and time OIDs (1082, 1083, 1114, 1184, 1186) are parsed as the raw text;
- never `.simple()`.

**`runAssistantSql`:**
- Validate the inputs: `accountId` and each business id must be UUIDs, and there is at least one business id. Otherwise throw `Error('assistant_sql: bad scope')`.
- Then `client.begin('read only', async (tx) => …)`. Inside, one `select set_config(…, true)` statement for:
  - `app.account_id`;
  - `app.assistant_business_ids` (`'{' + ids.join(',') + '}'`, as a parameter);
  - `statement_timeout` `'3000'`, `lock_timeout` `'1000'`, `idle_in_transaction_session_timeout` `'5000'`;
  - `search_path` `'assistant_sql'`, `TimeZone` `ASSISTANT_SQL_TIMEZONE`, `work_mem` `'16MB'`.
- Read both app GUCs back; if either differs, throw `Error('assistant_sql: context was not applied')`.
- Then `for await (const batch of tx.unsafe(input.sql).cursor(maxRows + 1)) { rows = batch; break; }` (Ruling 2-R7).
- Map the column type OIDs:
  - 20, 21, 23, 700, 701 and 1700 → `number`;
  - 16 → `boolean`;
  - 1082, 1114 and 1184 → `date`;
  - 25, 1043 and 2950 → `text`;
  - anything else → `other`.
- Convert number cells with `Number(x)` when `Number.isFinite` and (for integers) `Number.isSafeInteger`; otherwise keep the string. `other` cells become `String(x)`.
- `truncated = rows.length > maxRows`, and the rows are cut to `maxRows`.
- A Postgres error (an object with `code`) is rethrown as `AssistantSqlError(code, message)`.

**Integration tests** (`assistant-sql.integration.test.ts`, Testcontainers as in `tenant.integration.test.ts`). Seed as the owner: accounts A and B, A with businesses A1 and A2, B with B1, and orders, order items, contacts, facts and bots in each. Then:

1. The login has no privilege on any `public` table: loop `has_table_privilege(login, c.oid, 'SELECT,INSERT,UPDATE,DELETE')` over `pg_class` in `public` and expect all false. It has `SELECT` on every `assistant_sql` view and no `INSERT`.
2. `pg_has_role(login, r, 'MEMBER')` is false for `app_tenant`, `app_system` and `app_assistant_reader`.
3. `has_column_privilege('app_assistant_reader', …)` is false for every column in the "never grant" list above.
4. `runAssistantSql` with A's scope and `select business_id, count(*) from orders group by 1` returns A1 and A2 only. With `businessIds: [A1]` it returns A1 only.
5. Account A with `businessIds: [B1]` (a forged list) returns zero rows from every view.
6. `businesses` returns A1 and A2 only, and the deleted business is absent.
7. Read-only: running `delete from orders` (direct call, no guard) throws `AssistantSqlError` (sqlstate `25006` or `42501`).
8. `select pg_sleep(5)` throws sqlstate `57014` in under 4.5 s.
9. `select g from generate_series(1, 1000) g` returns 500 rows and `truncated: true`.
10. `select 1; select 2` throws (extended protocol).
11. A missing scope throws `bad scope`.
12. `select * from public.orders` and `select * from pg_catalog.pg_authid` fail with `42501` (or `42P01` for the first one, since `public` is not on the search path).
13. No `SECURITY DEFINER` function in schema `public` is executable by the login: query `pg_proc` where `prosecdef` and `has_function_privilege(login, oid, 'EXECUTE')`, and expect an empty list.
14. Views and session state: a `customers` row shows `has_phone` true for a contact with `phone_provided_at`, and `select current_setting('TimeZone')` reads `Asia/Ho_Chi_Minh`. `current_setting` is not in the guard's allow-list; the test calls `runAssistantSql` directly.

**Steps:**
- [ ] Write the integration tests (they fail).
- [ ] Write the migration and the helper. Extend `ensureLoginRoles`, the CLI and the testing logins. Update the other callers of `ensureLoginRoles` (`apps/backend/test/support/harness.ts` and any `packages/db/src/*.integration.test.ts`: grep for it) to pass the new login.
- [ ] Run `pnpm --filter @agent-sales/db test` with the integration env the earlier slices used, then `pnpm check`.
- [ ] Commit `feat(db): add the read-only assistant_sql views, roles and runner (T-171)`.

### Task 3: Backend — `sql_schema` and `sql_query` as deferred native tools

**Files:**
- Modify: `apps/backend/src/common/config.ts` (`DATABASE_ASSISTANT_SQL_URL: z.string().url().optional()`) and `apps/backend/src/common/db/db.module.ts` (a new token `DB_ASSISTANT_SQL` → `createAssistantSqlClient(url).sql` or `null`, closed on shutdown like the others).
- Create: `apps/backend/src/modules/assistant/domain/ports/sql-runner.port.ts`

  ```ts
  export interface SqlRunColumn { name: string; type: 'number' | 'text' | 'boolean' | 'date' | 'other' }
  export interface SqlRunResult { columns: SqlRunColumn[]; rows: (string | number | boolean | null)[][]; truncated: boolean }
  export class SqlRunError extends Error { constructor(readonly sqlstate: string, message: string) }
  export interface SqlRunner { run(i: { accountId: string; businessIds: readonly string[]; sql: string }): Promise<SqlRunResult> }
  export const ASSISTANT_SQL_RUNNER = Symbol('ASSISTANT_SQL_RUNNER'); // provides SqlRunner | null
  ```

- Create: `apps/backend/src/modules/assistant/infrastructure/sql/postgres-sql-runner.ts`. It wraps `runAssistantSql`, maps `AssistantSqlError` to `SqlRunError`, and maps connection errors (no sqlstate, or class `08`) to `SqlRunError('08000', 'unavailable')`. It never logs the SQL.
- Modify: `apps/backend/src/modules/assistant/assistant.module.ts`. Provide `ASSISTANT_SQL_RUNNER` with a factory from `DB_ASSISTANT_SQL`: `null` when unset.
- Create: `apps/backend/src/modules/assistant/application/sql/sql-views.ts`

  ```ts
  export interface SqlViewColumn { name: string; type: string; description: string }
  export interface SqlView { name: string; description: string; columns: SqlViewColumn[]; examples: string[] }
  export const SQL_VIEWS: readonly SqlView[];          // spec §4.3, same column order
  export const SQL_VIEW_NAMES: ReadonlySet<string>;
  export const SQL_RULES: string;                       // spec §6 rules block, English
  export function renderSqlOverview(): string;          // rules + `name(col, …) — description` per view
  export function renderSqlView(name: string): string | null;
  ```

  - Example queries use only allow-listed functions; a unit test runs each example through `checkSql`.
  - At least these:
    - revenue this week per business;
    - top 5 products last month by qty;
    - new customers this month by `source_name`;
    - inbound messages per day for 7 days with `generate_series`.
- Create: `apps/backend/src/modules/assistant/application/sql/sql-tools.ts`

  ```ts
  export interface NativeToolEntry {
    key: string; summary: string; when: string; toolset: 'sql';
    input: ZodType;
    run(input: unknown): Promise<{ content: string; ok?: boolean }>;
  }
  export const SQL_QUERY_KEY = 'sql_query';
  export const SQL_SCHEMA_KEY = 'sql_schema';
  export const MAX_SQL_CALLS_PER_TURN = 8;
  export const MAX_SQL_CELL_CHARS = 200;
  export function sqlTools(ctx: { scope: OwnerScope; runner: SqlRunner; uiActions: AssistantUiAction[]; charts: { count: number } }): NativeToolEntry[];
  ```

  **`sql_schema`:**
  - Input: `{ view?: string ≤ 63 }`.
  - Returns `renderSqlOverview()` without a view, `renderSqlView(view)` with one, or `unknown_view`.
  - `when` (English, rich in search words): "Answer number questions about the shop: revenue, sales, profit, orders, best-selling products, stock, new customers by source, conversations and messages per channel or bot, lodging bookings. Read the SQL views first."

  **`sql_query`:**
  - Input: `{ sql: string ≤ 4000, businessIds?: uuid[] ≤ 50, chart?: ChartRequest }`. The `ChartRequest` schema comes in Task 4; in this task, accept `chart` as `z.unknown().optional()` and ignore it.
  - Order of operations:
    1. the call count (`sql_query_limit` after 8);
    2. `checkSql(sql, { views: SQL_VIEW_NAMES })` → `{ok:false, errorCode:'sql_rejected', reason}`;
    3. the business ids: every id must be in `scope.businessIds`, otherwise `unknown_business`;
    4. `runner.run({ accountId: scope.accountId, businessIds, sql })`;
    5. map `SqlRunError` (spec §6, step 3: `sql_timeout`, `sql_permission_denied`, `sql_unknown_name`, `sql_error`, `sql_unavailable`) with `sqlstate` and the message cut to 300 chars.
  - Output to the model:

    ```
    { ok: true, columns: string[], types: string[], rows: [...], rowCount, rowsShown, truncated }
    ```

    - String cells are cut to 200 chars.
    - The JSON is ≤ 8 000 chars: drop rows from the end until it fits, and set `rowsShown`.
    - Add `note: 'rowsShown < rowCount: aggregate or filter instead of listing'` when rows were dropped.
    - `<` is escaped as in `route-tools.ts`.
  - Log on failure: `assistant sql: <errorCode> sqlstate=<s>` with the run id only.
- Modify: `apps/backend/src/modules/assistant/application/route-catalog.ts`. `searchCatalog(catalog, query, pageRoute, extra: readonly { key: string; summary: string; when: string }[] = [])` scores the extra entries with the same tokens. Extra entries get no page boost, and the result shape stays `CatalogEntry | extra` with `use: 'read'`.
- Modify: `apps/backend/src/modules/assistant/application/route-tools.ts`. `RouteToolContext` gains `native?: readonly NativeToolEntry[]`.
  - `tool_search` passes them as `extra`.
  - `tool_describe(key)` for a native entry returns `{ key, use: 'read', pathParams: [], body: jsonSchema(entry.input) }`.
  - `tool_call` with a native key validates `body` with `entry.input` (`invalid_input` plus the first 5 issues), ignores `businessId`/`params`/`query`, runs the entry, and counts its content against `TURN_READ_BUDGET_CHARS` like a read.
  - Native keys are checked before route keys. A route key can never equal a native key: route keys start with a method.
  - Update the `tool_call` description: "… Native tools (sql_schema, sql_query) take their input in `body`."
- Modify: `apps/backend/src/modules/assistant/application/chat-turn.service.ts`.
  - Inject `ASSISTANT_SQL_RUNNER` (`@Inject`).
  - Build `sqlTools({ scope, runner, uiActions: ctx.uiActions, charts })` when the runner is not null and `sql` is not in the owner's disabled toolsets (1c), and pass them as `native` to `routeTools`.
  - The tool definitions list does not change.
- Modify: the 1c toolset list (`core`, `ui`, `memory`, `skills`, `routes`). Add `sql` (label key `assistant.toolsets.sql`, with i18n vi/en in Task 4) and its tool count: 2. If 1c counts uses by step tool name, document that SQL calls count under `routes` (Ruling 2-R5).

**Tests:**
- Unit (`__tests__/sql-tools.spec.ts`, with a `FakeSqlRunner` in `__tests__/factories/`):
  - a guard rejection never calls the runner;
  - `unknown_business`;
  - default business ids = `scope.businessIds`;
  - the result shape;
  - the 8 000-char cut sets `rowsShown`;
  - cells cut to 200 chars;
  - `<` is escaped;
  - each `SqlRunError` mapping;
  - the 9th call returns `sql_query_limit`;
  - `sql_schema` overview < 6 000 chars, a view, `unknown_view`;
  - every example passes `checkSql`.
- Unit (`route-tools`):
  - `tool_search('revenue this week')` ranks `sql_query` or `sql_schema` in the top 3 when native entries exist;
  - `tool_describe('sql_query')` gives the body schema;
  - `tool_call({key:'sql_query', body:{sql:'select 1 from orders'}})` runs the native entry;
  - without native entries, `sql_query` is `unknown_key`.
- Integration (`apps/backend/test/assistant-sql.integration.spec.ts`; the harness sets `DATABASE_ASSISTANT_SQL_URL` from the new testing login). Seed owner A (two businesses) and owner B, each with orders. Use the fake LLM gateway as in `assistant.integration.spec.ts`:
  - A's turn calls `tool_search` → `tool_call sql_query` (`select b.name, sum(o.total) from orders o join businesses b using (business_id) where o.counts_as_revenue group by 1`), and the tool result the gateway receives on the next round holds A's two businesses and A's totals only;
  - `businessIds: [<B's id>]` → `unknown_business`;
  - a staff member of A's business gets 403 on `POST …/messages` (unchanged);
  - the catalog matches the DB: for each view in `SQL_VIEWS`, the owner connection's `information_schema.columns` (schema `assistant_sql`, ordered by `ordinal_position`) equals the `columns[].name` list;
  - with `DATABASE_ASSISTANT_SQL_URL` unset (a second app instance or a module override that provides `null`), `tool_search` does not return `sql_query`.

**Steps:**
- [ ] Write the unit tests, then the integration test (they fail).
- [ ] Implement.
- [ ] Run `pnpm --filter @agent-sales/backend test -- assistant`, the integration spec, and `pnpm check`.
- [ ] Commit `feat(assistant): answer data questions through the read-only SQL lane (T-171)`.

### Task 4: Charts from query rows, rendered in the bubble

**Files:**
- Create: `apps/backend/src/modules/assistant/application/sql/chart.ts`

  ```ts
  export const ChartRequest = z.object({
    kind: z.enum(['bar', 'line', 'pie']),
    title: z.string().trim().min(1).max(120),
    x: z.string().max(63),
    y: z.array(z.string().max(63)).min(1).max(4),
    unit: AssistantChartUnit.optional(),          // default 'number'
    labels: z.record(z.string().max(63), z.string().max(60)).optional(),
  });
  export const MAX_CHARTS_PER_TURN = 3;
  export function buildChart(req: z.output<typeof ChartRequest>, result: SqlRunResult):
    | { ok: true; chart: AssistantChart }
    | { ok: false; errorCode: string };
  ```

  - Errors:
    - `chart_unknown_column:<c>` (x or y not in the columns);
    - `chart_not_numeric:<c>` (a y column whose type is not `number`, or a cell that is neither a number nor null);
    - `chart_needs_full_result` (truncated);
    - `chart_too_many_points` (> 60 rows; a pie > 12);
    - `chart_bad_pie` (a pie with more than one y, or a negative value);
    - `chart_empty` (no rows).
  - The chart:
    - `x` = `{ key: x, label: labels[x] ?? x }`;
    - `series` from `y` the same way;
    - each row = `{ [x]: String(cell).slice(0, 80) | null, [y_i]: number | null }`;
    - `unit` defaults to `'number'`.
  - The result must parse with `AssistantChart` (a test asserts it).
- Modify: `sql-tools.ts`.
  - `sql_query` input `chart: ChartRequest.optional()`.
  - After a successful run, if `chart` is given: when `ctx.charts.count >= 3`, add `chart: { errorCode: 'chart_limit' }`. Otherwise call `buildChart` on the **full** result. On success, push `{ type: 'chart', chart }` to `ctx.uiActions`, increment the count, and add `chart: 'shown'`; otherwise add `chart: { errorCode }`.
  - A chart error never makes the call `ok: false`.
  - Update the `when` text and the description: "Pass `chart` to show a bar, line or pie chart built from the result rows; do not repeat every point in the answer."
- Modify: `chat-turn.service.ts`, `finalUiActions`. The order becomes the last navigate, the last fill_form, up to 3 charts in call order, then the last spotlight. Charts follow the same "none unless answered" rule. Update the MODULE.md line.
- Create: `apps/web/src/features/assistant/components/assistant-chart.tsx` (default export, so it can be lazy-loaded) and `assistant-chart.test.tsx`.
  - Use `ChartContainer`, `ChartTooltip`, `ChartTooltipContent` from `@/components/ui/chart`, and recharts `BarChart`/`Bar`, `LineChart`/`Line`, `PieChart`/`Pie`/`Cell`, `XAxis`, `YAxis` and `CartesianGrid`, the way `features/analytics/components/daily-chart.tsx` does.
  - The `ChartConfig` comes from the series, with colours `var(--chart-1)` … `var(--chart-4)`. No hex values.
  - Height 180 px, full width of the bubble message.
  - Formatting:
    - y ticks and tooltips: `vnd` → `formatCompactVnd` (tooltip `formatVnd`), `count` / `number` → `formatNumber`, `percent` → `formatNumber(v, 1) + '%'`;
    - an x value matching `^\d{4}-\d{2}-\d{2}` → `formatDay`.
  - A header with the title, and a toggle button (`assistant.chart.showTable` / `assistant.chart.showChart`) that switches to a shadcn `Table` of the same rows, formatted the same way.
  - Empty rows → the i18n text `assistant.chart.empty`.
- Modify: `apps/web/src/features/assistant/components/assistant-messages.tsx`.
  - For assistant messages, render each `chart` action below the text with `React.lazy(() => import('./assistant-chart'))` inside `Suspense`, with a `Skeleton` of 180 px as the fallback.
  - Charts of old messages render when the thread is reopened.
- Modify: `packages/i18n` `assistant` namespace (vi and en): `chart.showTable`, `chart.showChart`, `chart.empty`, `toolsets.sql`.

**Tests:**
- Backend `chart.spec.ts`: every error code; a bar chart of 7 days; a pie chart; label defaults; the output parses with `AssistantChart`; built from the full rows even when the model view was cut.
- `sql-tools.spec.ts`: the chart is pushed to `uiActions`; the 4th chart returns `chart_limit`; a chart error keeps `ok: true`.
- `chat-turn.service.spec.ts`: `finalUiActions` keeps 3 charts in order between fill_form and spotlight, and an unanswered turn has none.
- Integration (extend `assistant-sql.integration.spec.ts`): a `sql_query` with `chart` → the answer message's `uiActions` holds one `chart` whose rows equal the DB totals.
- Web:
  - the chart test renders the title and, after the toggle, a table row per data row with formatted VND;
  - a pie chart renders;
  - the messages test: an assistant message with a `chart` action shows the chart (await the lazy import);
  - the panel test from Task 1 still passes.
  - Mock `ResizeObserver` as the existing chart tests do; grep `ResizeObserver` in `apps/web/src`.

**Steps:**
- [ ] Write the tests (they fail).
- [ ] Implement.
- [ ] Run `pnpm --filter @agent-sales/backend test -- assistant`, `pnpm --filter @agent-sales/web test typecheck lint build`, and `pnpm check`.
- [ ] Check in the build output that recharts is not in the main entry chunk: it is already in the analytics chunk and now in a lazy chunk.
- [ ] Put the change on the dev servers and ask a data question in the bubble (owner rule: dev server before owner tests).
- [ ] Commit `feat(assistant): show charts built from query rows in the bubble (T-171)`.

### Task 5: Platform skill, configuration and deploy

**Files:**
- Create: `packages/ai-core/assistant-skills/answer-data-questions/SKILL.md`. Front matter: `name: answer-data-questions`, a description ≤ 120 chars, `toolsets: [sql]`, `version: 1`. The English body (≤ 8 000 chars):
  1. find the tools with `tool_search` ("revenue sql");
  2. call `tool_call` with key `sql_schema`;
  3. settle the date range in Asia/Ho_Chi_Minh and the business (all of the owner's businesses by default; group by business when there is more than one);
  4. write one aggregated `SELECT` with a date filter and run `sql_query`;
  5. revenue = closed orders (`counts_as_revenue`); say so, and give the range;
  6. use `chart` only for a time series or a ranking of 3 or more points;
  7. on `sql_timeout` or `rowsShown < rowCount`, narrow or aggregate; never estimate or fill gaps;
  8. figures exactly as returned, money as VND;
  9. customer phone numbers and emails are not in the views; for contact details, open `/app/customers`.

  It must pass `lintSkill` (only `/app/…` paths, no URLs).
- Modify: `packages/ai-core/assistant-skills/read-revenue/SKILL.md` → `version: 2`, `toolsets: [sql, routes]`. Step 2 becomes: "Load answer-data-questions and use the SQL lane; if `sql_query` is not found by tool_search, read the sales overview route as before." The rest is unchanged.
- Modify: the platform skills test, if it lists the skill names (grep `read-revenue` in `apps/backend/src/modules/assistant/__tests__` and `packages/ai-core`).
- Modify: `.env.example`. Add `DATABASE_ASSISTANT_SQL_URL=postgres://rapiz_assistant:rapiz_assistant_dev@localhost:5433/rapiz`, using the same host and port as `DATABASE_SYSTEM_URL`, with a comment: "Read-only SQL lane of the owner assistant (T-171); unset = lane off."
- Modify: `infra/deploy/bootstrap.sh`. Generate `assistant=$(pw)` and write `DATABASE_ASSISTANT_SQL_URL=postgres://rapiz_assistant:$assistant@postgres:5432/rapiz`. The compose services read `.env` through `env_file`, so `compose.yml` needs no change; verify this.
- Modify: `docs/runbooks/deploy-vps.md`, with a step for existing installs: append the line with `openssl rand -hex 24` to `/opt/apps/rapiz/.env`, then run `./deploy.sh` (the migrate service's `--login-roles` creates the login). Verify with `psql … -c "select rolname from pg_roles where rolname = 'rapiz_assistant'"`.
- Run `bash scripts/verify-setup.sh` if it checks env keys, and update it only if it fails on the new key (it is a repo maintenance script, not protected config).

**Tests:**
- The skill loads and lints: the existing test that calls `loadSkillDir` on the real folder covers it.
- A turn of the fake LLM that calls `load_skill('answer-data-questions')` returns its body.

**Steps:**
- [ ] Write the files.
- [ ] Run `pnpm --filter @agent-sales/ai-core test`, `pnpm --filter @agent-sales/backend test -- assistant`, and `pnpm check`.
- [ ] Run `pnpm --filter @agent-sales/db db:migrate:dev` locally, check that the login exists, and ask "doanh thu tuần này" in the dev bubble.
- [ ] Commit `feat(assistant): teach the data-question flow and configure the SQL lane login (T-171)`.

### Task 6: Docs

**Files:**
- Modify: `docs/superpowers/specs/2026-11-02-owner-assistant-data-questions-design.md`. Add §14 "Adjustments made while building", with anything that differs from the plan (at least: cursor or LIMIT wrapper, 2-R7).
- Modify: `docs/superpowers/specs/2026-11-02-owner-assistant-core-design.md`. In the capability table, row 2 links the new spec and says shipped. In §17, the SQL lane is out of scope of the core only.
- Modify: `docs/adr/ADR-004-multi-tenant-rls.md`, a new amendment line (2026-11-02, T-171). It records:
  - `app_assistant_reader` (NOLOGIN view owner, column grants, `FOR SELECT` policies through `assistant_sql_business_ids()`);
  - `app_assistant_sql` (`SELECT` on `assistant_sql` views only) and its own login;
  - the GUCs `app.account_id` + `app.assistant_business_ids`, transaction-local;
  - read-only transactions and the 3 s timeout.
- Modify: `docs/adr/ADR-024-owner-assistant.md`, a consequence line: capability 2 shipped (migration 0060); the views are the module's one read path outside the declared routes; a base-column change must recreate its view. Flag both ADR edits in the PR body (Ruling 2-R12).
- Modify: `docs/ARCHITECTURE.md`. In the §3 `assistant` row, add the `assistant_sql` views (read-only, own login) as the exception to "only through declared routes". In §2 Tenancy, add a line on the SQL lane.
- Modify: `docs/05-data-model.md`: schema `assistant_sql`, the 11 views and their columns, the two roles, and the rule that a migration changing a viewed column recreates the view.
- Modify: `docs/09-security-and-compliance.md`: the SQL lane threat model (spec §3) and the PII exclusion list.
- Modify: `docs/16-performance-and-scale.md`: SQL lane budgets (3 s statement, 500 rows, pool 4 per api process, 8 queries per turn) and the lazy chart chunk.
- Modify: `docs/10-operations-and-deployment.md` or `docs/runbooks/deploy-vps.md` (whichever lists env vars): `DATABASE_ASSISTANT_SQL_URL`.
- Modify: `apps/backend/src/modules/assistant/MODULE.md`:
  - the SQL lane (port, runner, native catalog entries, guard, limits, errors);
  - charts in `finalUiActions`;
  - the depends-on line (`DB_ASSISTANT_SQL` through `infrastructure/sql`).
- Modify: `packages/db/README.md`: the third login and the processes that use it (`api` only).
- Modify: `docs/12-roadmap-and-plan.md` or the task board, if T-171 is listed there.

**Steps:**
- [ ] Update the docs.
- [ ] Run `pnpm format` and `pnpm check`.
- [ ] Commit `docs(assistant): record the data-questions slice (T-171)`.
- [ ] Open the PR with the `open-pr` skill. In the body, list the rulings 2-R1…R12, the ADR edits for the maintainer, the security test list (Task 2, tests 1–13), and the dev-server check.
