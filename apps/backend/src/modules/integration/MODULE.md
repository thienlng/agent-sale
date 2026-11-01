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
- `INTEGRATION_RUNNER` → `IntegrationRunner.tick()`, run every 2 s by the `worker` entry (guarded against overlap,
  like the analytics projector): `application/sync-runner.ts`.
- HTTP and DTOs: `packages/contracts/src/integration/` — `GET /integrations`, `POST /integrations/kiotviet/test`,
  `POST|PATCH|DELETE /integrations/kiotviet`, `POST /integrations/kiotviet/sync`, `GET /integrations/kiotviet/log`
  (`interface/http/integration.controller.ts` → `application/connection.service.ts`). GETs need
  `catalog.manage`, writes `settings.manage`.
- Events: none yet.

**Depends on:** the `commerce` (`CATALOG_SYNC_FACADE`: partial upserts, removals, stock, pictures, linked ids), `crm` and `workspace` facades. Nothing depends on
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
- Connection lifecycle (`ConnectionService`): `test` stores nothing (store name via `parseRetailer`, branches,
  preview over at most 3 000 product codes, with `scanned` and the store `total` from `productCount`); `connect` refuses a live connection (409), checks the sale
  branches exist (`kiotviet_branch`), seals the client secret and a random 24-byte webhook secret (registered
  base64-encoded; the sealed value is that base64 text), creates the connection `syncing`, enqueues `full_import`, registers
  `product.update`/`product.delete`/`stock.update` webhooks at `${PUBLIC_WEBHOOK_BASE_URL}/webhooks/kiotviet/<token>`
  (each id saved in `settings.webhookIds` as soon as it registers; failure or no base URL → log
  `webhook_register_failed`) and logs `connected`; any failure after the insert sets status `error` with
  `lastError.code = 'connect_failed'` (best effort) and rethrows. `update` needs settings or credentials (`nothing_to_update`), checks `version`, accepts
  credentials only for the same store (`kiotviet_retailer_changed`), re-tests them, reseals and clears the error;
  a sale-branch change enqueues `reconcile` with `payload.full = true`. `syncNow` enqueues `reconcile` (409
  `sync_running`). `disconnect` deletes the saved webhooks plus any KiotViet lists at the connection URL (best effort), releases the commerce links and sets
  `disconnected`. Calls the owner waits on use `KIOTVIET_GATEWAY.interactive()`: one try, 10 s timeout, no
  retries or `Retry-After` waits, budget spent without waiting (background calls repay the debt; past 60
  calls of debt an interactive call fails fast with 503). A stored secret that no longer opens is
  `kiotviet_auth` (the "update the code" path), not a 500.
- Connect errors are 400 `VALIDATION_FAILED` with `details.reason` (`kiotviet_auth`, `kiotviet_retailer`,
  `kiotviet_permission` + `missing`); an unreachable KiotViet is 503 `UNAVAILABLE`.
- Persistence: one live connection per workspace and provider (`ConnectionExistsError`); `version` counts
  owner edits only (`settings`, `retailer`, `clientId`, `clientSecretSealed`; runner writes such as status,
  progress, counts and errors leave it), and a stale `expectedVersion` is `ConnectionVersionConflictError` (409). At most one open
  `full_import`/`reconcile` per connection (`enqueue` returns `false`). The worker claims jobs with
  `FOR UPDATE SKIP LOCKED` (ready `run_after`, free or expired lease; new `claim_token`, `attempts + 1`);
  cursor/complete/retry/fail are fenced by the claim token and return `false`
  when the lease was lost (the runner then aborts); `saveCursor` is the heartbeat that extends the lease. Only `full_import`, `reconcile` and `webhook`
  are claimed in PR 1. Idle open jobs of a disconnected connection are closed (`done_at`,
  `last_error = 'connection_disconnected'`) instead of claimed. Webhook deliveries are claimed at most once
  (marked processed in the claiming statement; reconcile covers a loss); a disconnected connection's
  deliveries are consumed but not returned. The sync log keeps the newest 200 entries per connection.
- Sync (`SyncService` → `CatalogImport` / `CatalogWriter`, `WebhookApplier`): the tick queues a `reconcile` for
  connections due (last one > 10 min ago, scanned once a minute), runs ≤ 5 claimed jobs (lease 5 min) one after
  the other, then applies ≤ 50 webhook deliveries; without a database it does nothing. A `full_import` (or a
  `reconcile` with `payload.full`, or one with no `lastReconcileAt`) sets `syncing` + `progress` and reads
  products (pages of 100), then on-hands of the sale branches, saving the cursor (`phase`, `currentItem`, the
  sale branches used, start time, seen KiotViet ids as sorted number arrays) after every page; a retry resumes
  there. A plain `reconcile` reads changes since `lastReconcileAt − 2 min` and archives `removeId`s. Before
  each page and write batch the connection is re-read: disconnected → the job completes without writing. Jobs
  of a connection whose connect failed, and `webhook` jobs, complete with no work. Groups whose master is not
  in the page fetch it by id (a vanished master drops the group). Every upsert is `{ partial: true }`; a full
  import that read every page in full archives linked products and variants it did not see, and the
  unlinked (Rapiz-only) variants left on linked products. Product pages are read without inventory
  (`includeInventory` off); stock comes from the on-hands phase. Pictures go
  through the image cache; failures are counted (`image_failed {count}` once per run). An item's link or
  code race (`CONFLICT`) is retried once, then logged `sku_conflict {sku}`, as is every skipped SKU. Success:
  `connected`, `progress` null, `lastError` null, `counts.products`, `lastReconcileAt` = run start (and
  `lastFullSyncAt`, `full_sync_done {products, images_failed}` for full runs); a sale-branch change during the
  run queues `reconcile {full: true}`. Errors: auth/retailer/permission (or a secret that no longer opens) →
  `error` + `lastError.code = 'auth_failed'`, `failJob`, `auth_failed` logged once; anything else retries at
  +1/+5/+30 min, then fails with `error` status and `kiotviet_unavailable` or `sync_failed`. A `false` from
  any fenced job write stops the job at once.
- Webhook deliveries: signature = HMAC-SHA256 keyed by the registered secret text (`webhookSigningKey`, one
  line to change); bad → `webhook_bad_signature`, dropped. `Notifications[].Action` loses its retailer
  suffix; `product.update` / `stock.update` re-read the products by id (never the payload) and upsert the
  group / set stock from their inventories; `product.delete` archives the `RemoveId`s; other actions log
  `webhook_unknown {type}` once per type and process.
- Never log secrets, tokens or customer data: log codes and counts (rule 07).

**Do not:** read `commerce`/`crm` tables (use their facades); put HTTP, Zod or Drizzle types in `domain/`.

**Test:** `pnpm --filter @agent-sales/backend test -- integration`
