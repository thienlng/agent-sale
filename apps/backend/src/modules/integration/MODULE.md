# integration

> Under construction (PMS integration PR 1). Sections marked _(planned)_ land in later tasks.

**Purpose:** connects a workspace to an external shop management system (PMS) and mirrors its catalog,
stock and customers into Rapiz. KiotViet is the first provider; for linked records the PMS is the source of
truth (ADR-017, spec `docs/superpowers/specs/2026-11-01-pms-kiotviet-design.md`).

**Owned tables:** `integration_*` tables (schema in `packages/db/src/schema/integration.ts`), behind
`INTEGRATION_STORE` (`application/ports/integration-store.ts`; Drizzle adapter in `infrastructure/persistence/`,
a 503 `UNAVAILABLE` stand-in when the process has no database).

**Public API (`api/`):**

- `INTEGRATION_FACADE` → `IntegrationFacade` _(use cases planned)_
- HTTP and DTOs: `packages/contracts/src/integration/` _(controller planned)_
- Events: none yet.

**Depends on:** the `commerce` (`CATALOG_SYNC_FACADE`), `crm` and `workspace` facades. Nothing depends on
`integration` (tier 3, docs/ARCHITECTURE.md §3).

**Events consumed:** none.

**Invariants:**

- `domain/` is pure: KiotViet → catalog mapping (`kiotviet-mapping.ts`: one product per master, master is
  variant position 0, children by id; the unit joins the variant name only when a group has several units;
  a lone unnamed variant keeps the product form's empty name), sale-branch stock (`stock.ts`: Σ max(0,
  onHand − reserved), missing branches count 0), webhook signature (`signature.ts`, constant-time HMAC-SHA256)
  and store-name parsing (`retailer.ts`).
- `KIOTVIET_GATEWAY` (`application/ports/kiotviet-gateway.ts`) is the only way to KiotViet; the adapter
  `infrastructure/clients/kiotviet-client.ts` caches one token per client id and secret (renewed 300 s before
  expiry, one request in flight), renews once on 401 (a second 401 → `kiotviet_retailer`), maps 403 to
  `kiotviet_permission`, retries 429/5xx/timeouts (15 s, body read included) after 1 s/4 s/15 s or
  `Retry-After` (≤ 60 s), and spends an in-memory budget
  of 4 500 requests/hour per store (bursts of 10). Payloads use tolerant Zod schemas
  (`kiotviet.schemas.ts`); malformed list items are dropped and counted. Tests run against
  `__tests__/fake-kiotviet.ts`.
- Connect errors are 400 `VALIDATION_FAILED` with `details.reason` (`kiotviet_auth`, `kiotviet_retailer`,
  `kiotviet_permission` + `missing`); an unreachable KiotViet is 503 `UNAVAILABLE`.
- Persistence: one live connection per workspace and provider (`ConnectionExistsError`); every update bumps
  `version`, and a stale `expectedVersion` is `ConnectionVersionConflictError` (409). At most one open
  `full_import`/`reconcile` per connection (`enqueue` returns `false`). The worker claims jobs with
  `FOR UPDATE SKIP LOCKED` (ready `run_after`, free or expired lease; new `claim_token`, `attempts + 1`);
  cursor/complete/retry/fail are fenced by the claim token. Only `full_import`, `reconcile` and `webhook`
  are claimed in PR 1. Idle open jobs of a disconnected connection are closed (`done_at`,
  `last_error = 'connection_disconnected'`) instead of claimed. Webhook deliveries are claimed at most once
  (marked processed in the claiming statement; reconcile covers a loss); a disconnected connection's
  deliveries are consumed but not returned. The sync log keeps the newest 200 entries per connection.
- Never log secrets, tokens or customer data: log codes and counts (rule 07).

**Do not:** read `commerce`/`crm` tables (use their facades); put HTTP, Zod or Drizzle types in `domain/`.

**Test:** `pnpm --filter @agent-sales/backend test -- integration`
