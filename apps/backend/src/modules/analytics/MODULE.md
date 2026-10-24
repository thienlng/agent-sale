# analytics

**Purpose:** statistics on customers, tags, statuses and conversations: versioned metric definitions, an event-fed projection, and queries with drilldown (ANA-01..03; docs/analytics.md).

**Owned tables:** none yet (T-040 adds the projection tables; schema in `packages/db/src/schema/analytics.ts`).

**Public API (`api/`):**

- `ANALYTICS_FACADE` → `definitions()` (the versioned metric table). HTTP: `GET /analytics/definitions` (capability `analytics.view`).
- Events: none published.

**Events consumed:** none yet (T-040: `crm.*` and `conversation.*` through the outbox).

**Invariants:**

- Every metric has a definition in `packages/contracts/src/analytics` (kind, grain, timestamp, distinct key, origins, attribution, filters); a query quotes the definition version and is rejected when it does not match or asks for something a metric cannot do (`validateAnalyticsQuery`).
- Event metrics and snapshots are never mixed; a ratio with a zero denominator is `null`; a metric without a data source is an error, never a 0.
- Dates are local inclusive days converted to half-open UTC instants.

**Do not:** read other modules' tables or call their facades to compute numbers (use the projection); store names, phone numbers or message text in facts; put HTTP/Drizzle types in `domain/`.

**Test:** `pnpm --filter @agent-sales/backend test -- analytics` and `pnpm --filter @agent-sales/contracts test`
