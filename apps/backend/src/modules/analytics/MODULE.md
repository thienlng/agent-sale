# analytics

**Purpose:** statistics on customers, tags, statuses and conversations: versioned metric definitions, an event-fed projection, and queries with drilldown (ANA-01..03; docs/analytics.md).

**Owned tables:** `analytics_facts` (tenant, forced RLS, append-only for the app role), `analytics_checkpoints` (the horizon) and `analytics_dead_letters` (global, app_system only) — migrations 0020, 0021; schema in `packages/db/src/schema/analytics.ts`.

**Public API (`api/`):**

- `ANALYTICS_FACADE` → `definitions()` (the versioned metric table). HTTP (capability `analytics.view`): `GET /analytics/definitions`, `POST /analytics/query`, `POST /analytics/drilldown`.
- `ANALYTICS_RUNNER` → `tick()`: projects one batch of outbox events into facts (run by the `worker` entry every 2 s; queries also catch up before answering).
- Events: none published. CLI: `analytics-rebuild <workspace-id>`.

**Events consumed:** `crm.contact.created|updated|status_changed|assigned.v1`, `crm.tag.assigned|removed.v1`, `conversation.message.received.v1`, `conversation.reply.completed.v1`, read from `outbox_events` by id (not through other modules' facades).

**Invariants:**

- Every metric has a definition in `packages/contracts/src/analytics` (kind, grain, timestamp, distinct key, origins, attribution, filters); a query quotes the definition version and is rejected when it does not match or asks for something a metric cannot do (`validateAnalyticsQuery`).
- Event metrics and snapshots are never mixed; a ratio with a zero denominator is `null`; a metric without a data source is an error, never a 0.
- Dates are local inclusive days converted to half-open UTC instants.
- One fact per (workspace, outbox event, kind): replays and duplicates never double count. Facts hold ids and times only. Late events are bucketed by when they happened.
- The projector keeps a transaction horizon, not an outbox id: a pass reads the rows of the transactions that finished since the last horizon, under an advisory lease, so a row that commits after a higher id is never skipped. Unparseable events are dead-lettered, database errors are retried; a rebuild replaces a workspace's facts in one transaction.
- Temporal state (tag active between add and remove, status and owner at a time) is derived from facts at query time, so arrival order cannot corrupt it.

- A card and its drilldown are computed from the same units at the same watermark; scope (owns it, or nobody does) is applied inside the SQL, so aggregates, rows and names agree.
- A query waits for the projector before reading (`catchUp`, up to 3 s), so what was committed before the call is included; the answer reports `lagSeconds` when the projection is behind. A request's `watermark` freezes the numbers (fact id) but never widens a viewer's scope.

**Depends on:** `workspace` (time zone), `billing` (entitlements → locked metrics) and `crm` (`contactNames` for drilldown rows) facades.

**Do not:** read other modules' tables or call their facades to compute numbers (use the projection); store names, phone numbers or message text in facts; put HTTP/Drizzle types in `domain/`.

**Test:** `pnpm --filter @agent-sales/backend test -- analytics` and `pnpm --filter @agent-sales/contracts test`
