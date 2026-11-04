# Owner assistant capability 2: data questions (read-only SQL lane and charts)

- Task: T-171 · Date: 2026-11-02 · Status: built (see §14 for what changed while building), awaiting review
- Parent design: [owner assistant core](2026-11-02-owner-assistant-core-design.md) (§1 capability 2, §3, §6). ADR: [ADR-024](../../adr/ADR-024-owner-assistant.md) decision 4 (lane a), [ADR-004](../../adr/ADR-004-multi-tenant-rls.md) (amended by this slice, §11).
- Builds on 1a, 1b and 1c (migrations 0057–0059). New migration: `0060`.

## 1. Goal

The owner asks questions about numbers in plain Vietnamese:

- "doanh thu tuần này bao nhiêu"
- "top 5 sản phẩm bán chạy tháng trước"
- "bao nhiêu khách mới từ Facebook"

The assistant answers with figures taken from the database. When a chart helps, it also shows a small chart in the bubble.

The model writes one `SELECT` over a **curated set of read-only views**. Postgres is the sandbox (core spec §1, constraint 4). The model never sees a base table, a secret, or a customer phone number, email or address. The model also never supplies a chart's numbers: our code builds the chart from the query's own rows.

Out of scope: schedules and reports (capability 3), exports and downloads, writes of any kind, owner-visible SQL, staff access, and question templates without the LLM.

## 2. Fixed constraints (from the core spec, unchanged)

1. Account owners only (`resolveOwnerScope`). The SQL lane sees only `scope.businessIds`: the account's businesses where the owner is an active member (ADR-012).
2. No external exposure: the SQL lane is a tool inside the assistant only.
3. No code sandbox. Postgres enforces read-only access, timeouts and visibility. Charts are a declarative spec that the web app renders.
4. Numbers come only from tool results (assistant persona hard rule).

## 3. Threat model

| Threat | Defence (each line stands even if the others fail) |
|---|---|
| The model writes data (`DELETE`, `UPDATE`, DDL, `SELECT … INTO`, `FOR UPDATE`) | The SQL guard allows one `SELECT`/`WITH` statement only. The login has no write grant anywhere. The transaction is `READ ONLY` and `default_transaction_read_only` is on for the login. |
| Reading another account's or another business's rows | The views run as `app_assistant_reader`, which has its own RLS policy on every base table. The policy is `workspace_id = ANY(<business filter>)`, an inlined sub-select (§4.2) that keeps only ids that are in `app.assistant_business_ids` **and** belong to `app.account_id`. Both values are set with `set_config(…, true)` by our code, from the owner scope. |
| The model forges the GUCs (`set_config`, `SET`) | `SET`/`RESET` are rejected statements, and `set_config`/`current_setting` are not allow-listed functions. Even with a forged value, the business filter needs the target account id together with business ids of that account. These are UUIDv7 values the model never sees for other accounts. |
| Escalating to the tenant role (`SET ROLE`, `RESET ROLE`) | The SQL lane uses its **own login** (`rapiz_assistant`, a member of `app_assistant_sql` only), not `SET ROLE` from the tenant login. That login is a member of nothing else, so there is no role to switch back to. |
| Reading base tables, secrets, PII columns or system catalogs | The login has `USAGE` on schema `assistant_sql` and `SELECT` on its views. It has no grant on any `public` table. The view owner has **column-level** grants that leave out phone, email, address, birthday, notes, tokens and settings, so even a wrong view cannot select them. The guard rejects `pg_*` identifiers, `information_schema`, `public.`, quoted identifiers and comments. `search_path` is `assistant_sql`. The login can still read the `PUBLIC` system catalog, but it runs with `track_activities = off` (superuser-only, set on the role), so no assistant session publishes its query text in `pg_stat_activity` for another session on the same login to read (§14). |
| Executing SQL through functions (`query_to_xml`, `dblink`), side effects (`pg_advisory_lock`, `pg_notify`), sleeping, catalog casts (`::regclass`) | A function allow-list: aggregates, window functions, and date, math and string helpers. A cast-type allow-list. Typed literals are allowed only for date and time types. |
| Load on the shared primary | `statement_timeout` 3 s, `lock_timeout` 1 s, `idle_in_transaction_session_timeout` 5 s and `work_mem` 16 MB per transaction. Memory: the guard allows no string-building function or operator (`||`, `concat`, `replace`, …) and caps string literals at 200 chars, so no expression grows past its inputs; the login has `work_mem = 16MB` and `temp_file_limit = 256MB` as role defaults (Postgres has no per-backend memory cap, so the guard's structural caps and the timeout are the bound; `work_mem` limits each plan node, not the query, §14). At most 501 rows are fetched through a cursor. Pool of 4 connections per process. At most 8 queries per turn, and one turn per owner (core §7). |
| Prompt injection through data (a customer name that says "ignore instructions") | Results are tool output, which the persona already treats as data. `<` is escaped as in the route tools, and cells are cut to 200 characters. |
| Leaking query text or results into logs | Logs carry the run id, `sqlstate` and error class only. The SQL text and the rows are never logged or stored in run steps. |
| Multi-statement smuggling | The guard rejects `;` (except one trailing), and the driver uses the extended protocol (never `.simple()`), which refuses more than one statement. |

## 4. Database design (migration 0060)

### 4.1 Roles

| Role | Kind | Privileges |
|---|---|---|
| `app_assistant_reader` | NOLOGIN, nobody is a member | Owns the views. Has column-level `SELECT` on the 15 base tables listed in §4.3, and a `FOR SELECT` RLS policy on each of them that inlines the business filter (§4.2). |
| `app_assistant_sql` | NOLOGIN group | `USAGE` on schema `assistant_sql` and `SELECT` on all its views. Nothing else. |
| `rapiz_assistant` (any name) | LOGIN, `IN ROLE app_assistant_sql` only | Created by `ensureLoginRoles` from `DATABASE_ASSISTANT_SQL_URL` (dev `--dev-roles`, deploy `--login-roles`). Role defaults: `default_transaction_read_only = on`, `statement_timeout = 3s`, `search_path = assistant_sql`, `idle_in_transaction_session_timeout = 5s`, `temp_file_limit = 256MB`, `work_mem = 16MB`, `track_activities = off`, `CONNECTION LIMIT 10`. An existing login is repaired: its group is granted again and any other membership is revoked. |

The views use the default `security_invoker = false`, so the reads behind a view are checked as the view owner (`app_assistant_reader`). This is why the login needs grants on the views only. Every view is `WITH (security_barrier = true)`, so the view's own filters (deleted rows, allowed fact kinds) run before any predicate the model writes.

### 4.2 Business filter

As built (§14): every reader policy inlines the same uncorrelated sub-select. There is no `assistant_sql_business_ids()` function.

```sql
USING (workspace_id = ANY ((SELECT coalesce(array_agg(w.id), '{}'::uuid[])
  FROM public.workspaces w
  WHERE w.id = ANY (nullif(current_setting('app.assistant_business_ids', true), '')::uuid[])
    AND w.account_id = nullif(current_setting('app.account_id', true), '')::uuid
    AND w.deleted_at IS NULL)::uuid[]))
```

- Policy on `workspaces` for the reader: the same three predicates on its own row (no sub-select, so there is no recursion).
- Relation access inside a policy sub-select is checked as the view owner, so the login needs no grant on `workspaces`. Postgres plans the sub-select as an InitPlan, evaluated once per query (a test checks the plan).
- The `::uuid[]` cast is needed: without it `ANY ((SELECT …))` is parsed as `ANY (subquery)` and compares a uuid with a uuid[].
- If either GUC is missing, the filter is `{}` and every view is empty. The runner also checks that both GUCs read back as set (the same rule as `withAccount`).

### 4.3 Views (schema `assistant_sql`)

Money is integer VND. Times are `timestamptz`. Every view has `business_id`.

| View | Columns | Source and filter |
|---|---|---|
| `businesses` | business_id, name, industry, timezone, created_at | `workspaces`, not deleted |
| `orders` | order_id, business_id, code, status, counts_as_revenue, is_cancelled, source, created_by_kind, item_qty, subtotal, discount_amount, shipping_fee, shipping_fee_charged, total, paid, remaining, cod_amount, cost_total, profit, customer_name, carrier, conversation_id, placed_at, confirmed_at, cancelled_at | `orders` where `deleted_at IS NULL`. `counts_as_revenue` = status in `CLOSED_ORDER_STATUSES`. `profit` = `subtotal − cost_total − discount_amount − (shipping_fee − shipping_fee_charged)`, the dashboard's formula. `customer_name` = `customer->>'name'` |
| `order_items` | order_item_id, business_id, order_id, product_id, variant_id, product_name, variant_name, sku, qty, unit_price, unit_cost, line_total, order_status, counts_as_revenue, placed_at | `order_items` joined to its order (not deleted) and its variant (for `product_id`) |
| `products` | product_id, business_id, code, name, category, status, visible_to_bot, created_at | `products` |
| `product_variants` | variant_id, business_id, product_id, sku, name, price, cost, archived, stock_on_hand, stock_reserved | `product_variants` plus the sums of `inventory` |
| `customers` | customer_id, business_id, name, province, source_name, first_source_name, status_name, has_phone, archived, created_at | `contacts` with the names of `crm_sources` and `crm_statuses`. `has_phone` = `phone_provided_at IS NOT NULL` |
| `conversations` | conversation_id, business_id, channel_id, channel_provider, bot_id, customer_id, status, mode, created_at, last_activity_at | `conversations` joined to `channel_connections` |
| `channels` | channel_id, business_id, provider, name, status, bot_id, created_at | `channel_connections` where `status <> 'removed'` |
| `bots` | bot_id, business_id, name, industry, is_active, order_taking, created_at | `bots`, not deleted |
| `activity_events` | business_id, kind, occurred_at, origin, customer_id, conversation_id, channel_id, bot_id | `analytics_facts` where kind is one of `customer.created`, `phone.captured`, `conversation.opened`, `message.inbound`, `message.outbound` |
| `lodging_bookings` | booking_id, business_id, property_id, property_name, code, status, source, check_in, check_out, nights, adults, children, guest_name, total_sell, adjustment, total_cost, counts_as_revenue, created_at | `lodging_bookings` where `kind = 'stay'`, joined to `lodging_properties`. `counts_as_revenue` = status in (`confirmed`, `checked_in`, `checked_out`). This has not been checked against a lodging figure on the dashboard (lodging has no revenue report yet). |

Left out on purpose: phone, email, address, birthday and gender of customers and recipients; `orders.recipient`; every free-text note (`note_internal`, `profile_note`, `note`); conversation and message text and `data` documents; `customer_phone` and platform `customer_id`; `token_sealed`, settings and external ids; staff names and user ids; anything billing, identity, assistant or audit.

### 4.4 Grants (column level, to `app_assistant_reader`)

Only the columns the view definitions read. For example: `orders(id, workspace_id, code, status, source, created_by_kind, item_qty, subtotal, discount_amount, shipping_fee, shipping_fee_charged, total, paid, remaining, cod_amount, cost_total, customer, carrier, conversation_id, placed_at, confirmed_at, cancelled_at, deleted_at)`. `orders.customer` is the one JSON column granted; its `phone`/`email` keys are never projected.

## 5. Running a query (`packages/db/src/assistant-sql.ts`)

`createAssistantSqlClient(url)` is a postgres.js client: `max 4`, `prepare: false`, `application_name = rapiz-assistant-sql`, and date/time types returned as raw text (so they are in the session time zone).

`runAssistantSql(client, { accountId, businessIds, sql, maxRows = 500 })`:

1. `client.begin('read only', …)`.
2. One statement sets, all with `is_local = true`:
   - `app.account_id`, and `app.assistant_business_ids` (`{id,…}` built from validated UUIDs and passed as a parameter);
   - `statement_timeout = 3000`, `lock_timeout = 1000`, `idle_in_transaction_session_timeout = 5000`;
   - `search_path = assistant_sql`, `TimeZone = Asia/Ho_Chi_Minh`, `work_mem = 16MB`.
3. Read both app GUCs back and throw `assistant_sql: context was not applied` if they differ.
4. `tx.unsafe(sql).cursor(maxRows + 1)`, take the first batch and stop. Return `{ columns: [{ name, typeOid }], rows, truncated }`.
5. Postgres errors become `AssistantSqlError { sqlstate, message }`.

## 6. Tools (toolset `sql`, deferred)

`sql_schema` and `sql_query` are **native entries** of the deferred catalog (core §6). `tool_search` finds them next to the route entries. `tool_describe({key})` returns their input schema. `tool_call({key, body})` runs them. They are not in the always-loaded tool list, so the tool list and the cached prompt prefix stay as they are. They are offered only when `DATABASE_ASSISTANT_SQL_URL` is configured and the owner has not disabled the `sql` toolset (1c settings).

### `sql_schema({ view? })`

- Without `view`: the rules block plus one line per view: `name(col, col, …) — description`. Under 6 000 chars.
- With `view`: each column with its type and description, plus 1–2 example queries.
- `unknown_view` for any other name.

The rules block (English, for the model):

- Money is integer VND.
- Times are local Asia/Ho_Chi_Minh (`placed_at::date`; weeks start on Monday with `date_trunc('week', …)`).
- Revenue (doanh thu) = `sum(total)` where `counts_as_revenue`. Sales (doanh số) = `sum(total)` where `NOT is_cancelled`. Profit = `sum(profit)` where `counts_as_revenue`. Best sellers come from `order_items` where `counts_as_revenue`.
- Always filter a date range and aggregate.
- Group by `business_id` and join `businesses` when there is more than one business.
- One `SELECT`; `WITH` is fine; no comments or quoted identifiers.
- Message counts come from `activity_events`. `message.outbound` covers both bot replies and page replies.

The descriptions live in `apps/backend/src/modules/assistant/application/sql/sql-views.ts`. An integration test checks them against `information_schema.columns` of the schema `assistant_sql`.

### `sql_query({ sql, businessIds?, chart? })`

1. **Guard** (`domain/sql-guard.ts`, pure, §7). If the guard fails, the call returns `{ok:false, errorCode, detail}` and nothing runs.
2. **Scope:** `businessIds` defaults to `scope.businessIds`. Every id must be in it, otherwise `unknown_business`.
3. **Run** through the `ASSISTANT_SQL_RUNNER` port. Error mapping:
   - `57014` → `sql_timeout` (hint: add a date filter or aggregate);
   - `42501` → `sql_permission_denied` (hint: only the views listed by `sql_schema`);
   - `42P01` / `42703` → `sql_unknown_name` with the Postgres message;
   - any other SQL state → `sql_error` with `sqlstate` and the message cut to 300 chars;
   - a connection failure → `sql_unavailable`.
4. **Result to the model:** `{ok:true, columns, rows (arrays), rowCount, truncated, rowsShown, chart?}`.
   - Numbers come back as JS numbers when they are safe integers or finite decimals, otherwise as strings. Dates come back as text and cells are cut to 200 chars.
   - The result is at most 8 000 chars: rows are dropped from the end, and `rowsShown` says how many were kept.
   - It counts against the route tools' 40 000-char read budget and the turn-wide output budget (1b).
5. **Limits:** at most 8 `sql_query` calls per turn (`sql_query_limit`). SQL text is at most 4 000 chars.

## 7. SQL guard (no new dependency)

The repo has no SQL parser, so the guard is a lexer plus allow-lists. It is strict on purpose: when it is unsure, it rejects the query. The database privileges are the real boundary; the guard gives early, readable errors and closes the function and GUC paths.

1. Length ≤ 4 000. Strip one trailing `;`. Reject control characters, and any non-ASCII character outside string literals.
2. Lex identifiers, numbers, `'…'` strings (`''` escape) and operators. Reject:
   - comments (`--`, `/*`);
   - `$` (dollar quotes and parameters);
   - `"` (quoted identifiers);
   - string prefixes `E' U&' B' X' N'`;
   - `;`;
   - any operator outside `= <> != < > <= >= + - * / % ( ) , . ::` (no `||`: final review C1);
   - a string literal longer than 200 chars, quotes included (`string_too_long`).
3. The first token is `select` or `with`. `recursive` is a denied word (step 4), so `with recursive` is rejected at any depth (final re-review I-B).
4. Denied words anywhere: `insert update delete merge into copy create alter drop grant revoke truncate set reset lock for call do execute prepare deallocate listen notify unlisten vacuum analyze explain refresh cluster reindex checkpoint load import discard declare fetch move close cursor returning table only tablesample recursive`. Also denied: identifiers starting with `pg_`, and `information_schema`, `public`, `assistant_sql`, `current_user`, `session_user`, `current_role`, `user`, `system_user`, `current_catalog`, `current_schema`.
5. A function call is an identifier followed by `(`, unless it is a SQL keyword that takes parentheses (`in exists any all some over filter as values using on and or not select from where join when then else case by having union intersect except between is like ilike distinct within group partition`). Such a call must be in the allow-list:
   - aggregates: `count sum avg min max bool_and bool_or every percentile_cont percentile_disc mode`;
   - window functions: `row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value`;
   - math: `round trunc floor ceil ceiling abs greatest least`;
   - null handling: `coalesce nullif`;
   - dates: `date_trunc date_part extract to_char make_date make_interval age now generate_series`;
   - strings: `lower upper length btrim trim ltrim rtrim substr left right split_part initcap position`. None of them builds a longer string; `concat`, `replace`, `repeat`, `lpad`/`rpad`, `format`, `overlay`, `translate`, `string_agg` and `array_agg` are not allowed (final review C1).

   A qualified call (`x.f(`) is rejected.
6. A cast (`::t`) and a typed literal (`t '…'`) must name an allowed type:
   - casts: `date timestamp timestamptz time interval numeric decimal int integer bigint smallint real float double precision text varchar boolean bool`;
   - typed literals: the date and time types only.

   `cast(` is rejected (the error says to use `::`).
7. A FROM item (right after `from` or `join`, or after a comma of a FROM list at the same parenthesis level) must be a view name or a CTE name of this query, a `(` subquery or `generate_series(…)`. Otherwise the call fails with `unknown_view:<name>`. A FROM list ends at `where group having order limit offset window union intersect except fetch` or at its closing parenthesis.
8. Parentheses must balance, depth ≤ 10, tokens ≤ 1 000, CTEs ≤ 10 (`too_many_ctes`), FROM items ≤ 6 across the whole query, comma-joined, joined and nested ones included (`too_many_relations`), and at most 1 `generate_series` call (`too_many_generate_series`) (final re-review I-A).

Error codes are `sql_rejected:<reason>`, for example `sql_rejected:function_not_allowed:pg_sleep`. The guard returns the trimmed SQL text, which runs unchanged.

## 8. Charts

- Charts come only from `sql_query`'s `chart` argument: `{ kind: 'bar' | 'line' | 'pie', title ≤ 120, x: <column>, y: <column>[1..4], unit?: 'vnd' | 'count' | 'percent' | 'number', labels?: { [column]: string ≤ 60 } }`. The model never types chart numbers.
- `application/sql/chart.ts` builds the chart from the **full** fetched rows (not the cut model view):
  - `x` and every `y` must exist (`chart_unknown_column:<c>`);
  - every `y` must be numeric or null (`chart_not_numeric:<c>`);
  - no column may be `__proto__` (`chart_reserved_column:__proto__`), which a plain object row would drop silently;
  - the result must not be truncated (`chart_needs_full_result`);
  - bar and line charts take at most 60 rows, pie charts at most 12 rows and exactly one non-negative `y` (`chart_too_many_points`, `chart_bad_pie`);
  - at most 3 charts per turn (`chart_limit`).

  A chart error never fails the query: the rows are returned with `chart: {errorCode}`.
- On success, a UI action `{ type: 'chart', chart: { kind, title, x: {key, label}, series: [{key, label}], unit, rows } }` is added to the turn. The rows hold only the `x` and `y` columns, with strings ≤ 80 chars. `finalUiActions` keeps navigate, fill_form, then up to 3 charts in call order, then spotlight. As before, a turn that did not answer gets no actions.
- Charts are stored in `assistant_messages.ui_actions`, so a reopened thread shows them again. This is aggregate business data on an account-scoped, RLS-protected row, which is the same reasoning as a proposal's result preview (1b-R10).
- **Web:** `features/assistant/components/assistant-chart.tsx` uses `recharts` 3.10.1 (already a dependency) through `components/ui/chart.tsx` (`ChartContainer`, chart colour tokens `--chart-1..4`).
  - It is lazy-loaded, so recharts loads only when a chart is shown.
  - Ticks and tooltips are formatted with `formatCompactVnd` / `formatNumber` / `%`. An x value that looks like `YYYY-MM-DD` is shown with `formatDay`.
  - A "Xem bảng" toggle shows the same rows as a shadcn `Table`.
  - The panel's action runner ignores `chart` actions: they are rendered inside the message, not executed.

## 9. Skills

- New platform skill `answer-data-questions` (toolsets `[sql]`). The flow it teaches:
  1. `tool_search` "revenue orders sql";
  2. `sql_schema`;
  3. settle the date range and the business;
  4. one aggregated query;
  5. a chart only for a series or a ranking of 3 or more points;
  6. say the range and that revenue counts closed orders;
  7. on `sql_timeout`, narrow the query; never estimate.
- `read-revenue` (version 2) points to `answer-data-questions` and keeps the route-based fallback for when the SQL lane is off.
- No prompt version change. New threads see the skill in their frozen skills index. Older threads still find the tools through `tool_search`.

## 10. Configuration and operations

- Env: `DATABASE_ASSISTANT_SQL_URL` (optional). When it is unset, the SQL entries are not in the catalog and `read-revenue` falls back to routes.
- `.env.example` gets a dev value. `infra/deploy/bootstrap.sh` generates a password for new installs. For the existing VPS, the deploy runbook adds one line to `.env`; `migrate --login-roles` then creates the login.
- The lane runs on the primary. Pointing the URL at a read replica later needs no code change: roles and views replicate.
- `activity_events` reads the analytics projection without the projector catch-up, so it may lag by the worker tick (~2 s).

## 11. ADR changes

- **ADR-004 amendment:** two new roles (`app_assistant_reader`, view owner, NOLOGIN; `app_assistant_sql`, SELECT on views only) and a third login. A multi-business predicate inlined in each policy, set by `app.account_id` + `app.assistant_business_ids`, both transaction-local. Reader policies are `FOR SELECT` only.
- **ADR-024 consequence line:** lane (a) shipped. Like an analytics read model, the `assistant_sql` views are the one place where the `assistant` module reads other modules' data without their routes. The views are a published read contract in `packages/db`. A migration that changes a column a view reads must recreate the view in the same migration (Postgres refuses to drop it otherwise).

## 12. Testing

- Guard unit tests: a table of at least 40 accepted and rejected queries, including every row of §3.
- DB integration tests (`packages/db`):
  - the login holds no privilege on any `public` table and is not a member of `app_tenant`, `app_system` or `app_assistant_reader`;
  - the reader has no privilege on the PII columns listed in §4.3;
  - two accounts are isolated;
  - a forged business id of another account returns nothing;
  - a raw `delete` fails as read-only, `pg_sleep(5)` times out at about 3 s, the row cap returns 500 rows plus `truncated`, and the driver refuses a multi-statement query;
  - no `SECURITY DEFINER` function in `public` is executable by the login.
- Backend:
  - tool unit tests with a fake runner;
  - the chart builder;
  - `finalUiActions` with charts;
  - an integration test of an owner's turn with a fake LLM that calls `tool_call → sql_query`: it sees only its own account's numbers, and the chart is stored on the answer;
  - staff get 403 (unchanged);
  - the catalog matches the DB views.
- Web: the chart renders a title and series, the table toggle works, and a `chart` action is not run by the action runner.

## 13. Rulings taken without the owner

Each ruling lists its cost if it is wrong. The plan repeats them as 2-R1…R12.

| # | Ruling | Cost if wrong |
|---|---|---|
| 2-R1 | Own login (`DATABASE_ASSISTANT_SQL_URL`) instead of `SET LOCAL ROLE` from the tenant login. `RESET ROLE` / `set_config('role', …)` would lead back to `app_tenant`, which can read any workspace by setting `app.workspace_id`. | One more secret and one deploy step; a second small pool. |
| 2-R2 | No SQL parser dependency. The guard is a lexer with allow-lists, and the DB privileges are the boundary. | Some valid SQL is rejected (quoted identifiers, `CAST(…)`, `substring(… from … for …)`); the model rewrites it. |
| 2-R3 | Views owned by a NOLOGIN `app_assistant_reader` with column-level grants and `FOR SELECT` policies with an inlined business filter (the designed `assistant_sql_business_ids()` function was dropped, §14). | 15 extra policies; a base-column change must recreate its view in the same migration. |
| 2-R4 | No phone, email, address, birthday, gender, notes or free text. Names of customers, guests and products are allowed; `has_phone` is a boolean. | The owner cannot list phone numbers through the assistant; the assistant can open the CRM page instead. |
| 2-R5 | `sql_schema` and `sql_query` are native entries of the deferred catalog, called through `tool_call`. No prompt version bump; a new platform skill teaches the flow. | One extra hop per question; run steps show `tool_call`, not `sql_query`, and 1c's usage counter counts SQL calls under `routes`. |
| 2-R6 | Charts are built only from `sql_query` rows; the model cannot type chart numbers. Chart rows are stored on the message. | No chart from route-tool results; aggregates stay on an account-scoped row. |
| 2-R7 | Row cap with a cursor (`cursor(501)`), not a `LIMIT` wrapper, so the model's `ORDER BY` holds and the SQL text runs unchanged. | If the postgres.js cursor is not usable on `unsafe`, fall back to `SELECT * FROM (<sql>) q LIMIT 501` (the guard already requires balanced parentheses). |
| 2-R8 | Every query runs in Asia/Ho_Chi_Minh, whatever the business's `timezone`. | Day edges are wrong for a business in another time zone. |
| 2-R9 | Lodging revenue = `kind = 'stay'` and status in `confirmed`, `checked_in`, `checked_out`, over `total_sell` (`adjustment` shown separately). | Not verified against a lodging figure; can be fixed by a view migration. |
| 2-R10 | The lane runs in `api` only (synchronous turn) on the primary, with pool 4 and 8 queries per turn. | Schedules (capability 3) must add the worker as a caller. |
| 2-R11 | SQL text and rows are never shown in steps, logs or the UI, except as a chart or the answer. | The owner cannot audit the query itself. |
| 2-R12 | ADR-004 and ADR-024 are amended in this PR (rule 05 requires it for a tenant-model change), flagged for the maintainer in the PR body. | The maintainer may ask for a separate ADR. |

## 14. Adjustments made while building (2026-11-02)

### Database (migration 0060, `packages/db`)

- **The business filter is inlined, not a function.** With `assistant_sql_business_ids()` as designed, every view query failed with `permission denied for function`: Postgres runs a function in an RLS policy as the **calling login**, not as the view owner. The two fixes that follow from the design both break the model: grant the login `EXECUTE` and `SELECT` on `workspaces` (the function is `SECURITY INVOKER`), or make it `SECURITY DEFINER`, which the tests forbid. Each of the 14 policies now inlines the same sub-select (§4.2). It is checked as the view owner and planned as one InitPlan. The policy also needs a `::uuid[]` cast.
- **2-R7: the cursor is used.** `tx.unsafe(sql).cursor(501)` works in postgres.js 3.4.9, so the `LIMIT` wrapper fallback is not used, and the model's SQL runs unchanged. Rows are read as arrays (`.values()`), so two output columns with the same name both survive. Under a cursor, postgres.js drops the rows of commands whose tag has no row count (`EXPLAIN`, `SHOW`); the guard only lets `SELECT`/`WITH` through.
- **Optional joins are `LEFT JOIN`** (variant → product, channel → provider, CRM sources and statuses, lodging property), so a missing row never hides a fact. `conversations.customer_id` is the CRM contact (`contact_id`), `conversations.last_activity_at` is `updated_at`, and `activity_events.customer_id` is `analytics_facts.contact_id`.
- **Types.** A bigint beyond 2^53 comes back as a string; dates and times are local text with `+07`; an interval is `other`.

### Runner and tools (`apps/backend`)

- **The guard runs twice:** in `sql_query`, and again in `PostgresSqlRunner` right before `runAssistantSql`. A runner-level rejection throws `SqlRunError('42501', …)` without reaching the database.
- **Session options are read back.** Before the query runs, the transaction must report `statement_timeout = 3s`, `idle_in_transaction_session_timeout = 5s`, `transaction_read_only = on`, the two scope GUCs and the login's `temp_file_limit = 256MB` and `track_activities = off`; any mismatch is `sql_unavailable` and nothing runs.
- **Logs** carry the error code, SQL state, run id and a fingerprint `sql=<sha256 first 12 hex> len=<n>`, never the SQL text or rows.
- **The guard** goes slightly beyond §7, always strictly or neutrally: `from generate_series(…)` passes the relation check; `extract(… from …)`, `trim(… from …)` and `is distinct from` are not relations; an identifier followed by a string is a typed literal unless it is an expression keyword (`ilike '%x%'`, `at time zone '…'`); CTE names include `as [not] materialized (`; operators are lexed like Postgres (a run of operator characters is one operator, a trailing `+`/`-` is trimmed).
- **The `sql` toolset is registered in the tool wiring only.** The 1c toolset list (with label keys) was built on another branch at the same time. `ChatTurnService` checks `sql` against `assistant_settings.disabled_toolsets`; adding `sql` (2 tools, label `assistant.toolsets.sql`, already in i18n) to the 1c list is waiting on 1c. SQL calls count under `routes` in 1c's usage counter (ruling 2-R5).
- **Charts** add the error `chart_duplicate_column:<c>` (x and a y, or two y, naming the same column), because a chart row is keyed by column name. Chart errors keep `ok: true`. The web chart keys its series `s0`…`s3`, because a column name such as `?column?` is not a valid CSS custom property; pie slices cycle through `--chart-1`…`--chart-5`.

### Final review fixes (2026-11-02)

- **C1, memory.** Chained CTEs with `||` or `concat` grew a string exponentially from linear SQL text: one guarded query took a backend past 1.4 GB in under 3 s. `statement_timeout` bounds time, not memory, and `work_mem` does not cover expression values. Fixes:
  - The guard drops `||`, `concat` and `replace` (no allowed function builds a longer string), caps string literals at 200 chars and CTEs at 10 (§7).
  - `ensureLoginRoles` sets `temp_file_limit = '256MB'` (superuser-only, so the login cannot raise it; it also bounds spilled sorts and hashes of `generate_series` cross joins) and `work_mem = '16MB'` on the login. The runner reads `temp_file_limit` back and refuses to run without it.
  - Postgres 16 has no role-level setting that caps a backend's total memory. `work_mem` limits each sort, hash or materialize node of the plan, not the whole query: a cross join of 60 `generate_series` calls kept 60 in-memory tuplestores and reached 728 MB before the timeout (final re-review I-A). What bounds memory is the guard's structural caps (no string building, literals ≤ 200 chars, CTEs ≤ 10, FROM items ≤ 6, one `generate_series`) plus the 3 s timeout; `temp_file_limit` caps what spills to disk.
- **Final re-review I-A and I-B.** The guard now counts FROM items, comma-joined ones included (it parses comma-joined FROM lists, so each comma item is also checked against the views), caps them at 6 per query, and allows one `generate_series` call. `recursive` is a denied word, so a nested `with recursive` that reuses an outer CTE or view name is rejected too. A probe in `postgres:16-alpine` with the login's settings put the heaviest allowed shapes (a cross join of five CTE scans, chained hash joins, sorts and windows) at under 100 MB per backend before the 3 s timeout.
- **I1, `pg_stat_activity`.** `ensureLoginRoles` sets `track_activities = off` on the login (superuser-only, so the login cannot turn it back on; the migrator is a superuser). No assistant session publishes its query text, so even a guard bypass shows another session's pid, user and timing, but no text. The runner reads the setting back and refuses to run without it. An integration test runs a query in one session and reads `pg_stat_activity` from another session on the login.
- **Attribute notation.** The guard does **not** block it: `select o.row_to_json from orders o` passes, because the guard does not know the view columns. Postgres accepts the notation only for a function with a single composite argument, so it can reach only serializers of a row the owner may already read; the grants still apply.
- `system_user`, `current_catalog` and `current_schema` are denied words. `ensureLoginRoles` repairs an existing login (group re-granted, other memberships revoked). A chart column named `__proto__` is refused (`chart_reserved_column`).

### Remaining gap

- The login can read Postgres's `PUBLIC` system catalog (`pg_class`, `pg_proc`, `pg_stat_activity` without query text). The guard rejects `pg_*` and `information_schema`.
- `PUBLIC`-executable built-ins (`query_to_xml`, `current_setting`, `set_config`) are blocked only by the guard; at the database level they run as the login and are bounded by its grants. Attribute notation (`t.f` calling `f(t)`) is not blocked (see above).
