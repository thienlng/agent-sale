# integration

> PMS integration: KiotViet catalog and stock (PR 1), order push (PR 2) and customer sync (PR 3).
> Owner guide and troubleshooting in `docs/integrations/kiotviet.md`.

**Purpose:** connects a workspace to an external shop management system (PMS) and mirrors its catalog,
stock and customers into Rapiz. KiotViet is the first provider; for linked records the PMS is the source of
truth (ADR-017, spec `docs/superpowers/specs/2026-11-01-pms-kiotviet-design.md`).

**Owned tables:** `integration_connections`, `integration_jobs`, `integration_webhook_events`,
`integration_image_cache`, `integration_sync_log` (migration 0040, forced RLS; schema in
`packages/db/src/schema/integration.ts`; columns in `docs/05-data-model.md` §6), behind
`INTEGRATION_STORE` (`application/ports/integration-store.ts`; Drizzle adapter in `infrastructure/persistence/`,
a 503 `UNAVAILABLE` stand-in when the process has no database).

**Public API (`api/`):**

- `INTEGRATION_FACADE` → `IntegrationFacade` — empty (nothing calls the module; the order push runs on the
  worker tick).
- `INTEGRATION_RUNNER` → `IntegrationRunner.tick()`, run every 2 s by the `worker` entry (guarded against overlap,
  like the analytics projector): `application/sync-runner.ts` (reconcile scan 1 min, order push scan 15 s,
  customer push scan 30 s, ≤ 5 jobs, ≤ 50 webhook deliveries).
- HTTP and DTOs: `packages/contracts/src/integration/` — `GET /integrations`, `POST /integrations/kiotviet/test`,
  `POST|PATCH|DELETE /integrations/kiotviet`, `POST /integrations/kiotviet/sync`, `GET /integrations/kiotviet/log`
  (`interface/http/integration.controller.ts` → `application/connection.service.ts`). GETs need
  `catalog.manage`, writes `settings.manage`. `POST /integrations/kiotviet/orders/{orderId}/push` ("Thử lại",
  `orders.manage`, 202; 409 `PUSH_NOT_FAILED` unless the push failed; 409 `not_pushing` when the
  workspace has no live connection pushing orders — none, `pushOrders` off, status not
  `connected|syncing`, or a failed connect — or the order was created before the connection) →
  `OrderPusher.retry` → `requeueOrderPush(ws, orderId, connection.createdAt)`.
- Webhook ingress: `apps/webhook` (`POST /webhooks/kiotviet/:token`) only inserts raw deliveries into
  `integration_webhook_events`; everything else (signature, parsing, writes) happens in this module's runner.
- Events: none yet.

**Depends on:** the `commerce` (`CATALOG_SYNC_FACADE`: partial upserts, removals, stock, pictures, linked ids; `ORDER_PUSH_FACADE`: claim, payload, mark pushed/failed, requeue, PMS status, pushed count), `crm` (`CONTACT_SYNC_FACADE`: upsert/unlink, push claim/read/mark/release, release on disconnect, linked count; `CrmModule` is imported) and `workspace` facades. Nothing depends on
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
  of 4 500 requests/hour per store (bursts of 10). `createOrder` (`POST /orders`) is never sent twice: only
  a 429 or a 401 token renewal repeats it; a timeout, network error or 5xx is `KiotVietUnavailableError` at
  once (the order may exist) and another 4xx is `KiotVietRejectedError`. `createCustomer` (`POST /customers`) follows the same once-mode rule (customer calls live in
  `kiotviet-customers.ts` on the client's transport). Call profiles and shared state live
  in `kiotviet-call.ts`, payload reading in `kiotviet-payload.ts`. Payloads use tolerant Zod schemas
  (`kiotviet.schemas.ts`); malformed list items are dropped and counted. Tests run against
  `__tests__/fake-kiotviet.ts`.
- Connection lifecycle (`ConnectionService`): `test` stores nothing (store name via `parseRetailer`, branches,
  preview over at most 3 000 product codes, with `scanned` and the store `total` from `productCount`); `connect` refuses a live connection (409), checks the sale
  branches exist (`kiotviet_branch`), seals the client secret and a random 24-byte webhook secret (registered
  base64-encoded; the sealed value is that base64 text), creates the connection `syncing`, enqueues `full_import`, also enqueues `customer_import` when `syncCustomers` is on, registers
  `product.update`/`product.delete`/`stock.update` webhooks (plus `order.update` when `pushOrders` is on,
  `customer.update`/`customer.delete` when `syncCustomers` is on) at
  `${PUBLIC_WEBHOOK_BASE_URL}/webhooks/kiotviet/<token>` (`application/webhook-set.ts`; each id saved in
  `settings.webhookIds` as soon as it registers; failure or no base URL → log `webhook_register_failed`) and logs `connected`; any failure after the insert sets status `error` with
  `lastError.code = 'connect_failed'` (best effort) and rethrows. `update` needs settings or credentials (`nothing_to_update`), checks `version`, accepts
  credentials only for the same store (`kiotviet_retailer_changed`), re-tests them, reseals and clears the error;
  a sale-branch change enqueues `reconcile` with `payload.full = true`. A settings save also ensures the
  webhook set (`WebhookSet.ensure`: list at the connection URL, register the missing types, delete
  `order.update` when push is off and the customer types when customer sync is off; the ids ride in the same versioned write; a type that fails to register
  logs `webhook_register_failed`, a failed list only the process log). Every reconcile ensures it too (the
  background gateway; ids saved only when changed, against the version read). `syncNow` enqueues `reconcile` (409
  `sync_running`; 409 `connect_failed` when `lastError.code = 'connect_failed'`, whose jobs the runner never
  runs: the owner must disconnect and connect again). `connected` is logged with `{ retailer, branches }`
  (`SyncLogParams` in the contracts lists every code's params). `disconnect` deletes the saved webhooks plus
  any KiotViet lists at the connection URL (best effort), sets `disconnected`, then releases the commerce
  links, the pending order pushes and the CRM links (`CONTACT_SYNC_FACADE.releaseExternalSource`, which also
  clears every customer push state) — status first, so running writers stop before the release. Calls the owner waits on use `KIOTVIET_GATEWAY.interactive()`: one try, 10 s timeout, no
  retries or `Retry-After` waits, budget spent without waiting (background calls repay the debt; past 60
  calls of debt an interactive call fails fast with 503). A stored secret that no longer opens is
  `kiotviet_auth` (the "update the code" path), not a 500.
- Connect errors are 400 `VALIDATION_FAILED` with `details.reason` (`kiotviet_auth`, `kiotviet_retailer`,
  `kiotviet_permission` + `missing`); an unreachable KiotViet is 503 `UNAVAILABLE`.
- Persistence: one live connection per workspace and provider (`ConnectionExistsError`); `version` counts
  owner edits only (`settings`, `retailer`, `clientId`, `clientSecretSealed`; runner writes such as status,
  progress, counts and errors leave it), and a stale `expectedVersion` is `ConnectionVersionConflictError` (409). At most one open
  `full_import`/`reconcile` per connection and one open `push_order` per order (`enqueue` returns `false`). The worker claims jobs with
  `FOR UPDATE SKIP LOCKED` (ready `run_after`, free or expired lease; new `claim_token`); `attempts` counts
  recorded failures only (`retryJob` increments it), so a re-claim after a lapsed lease (worker restart, slow
  page) never spends a retry;
  cursor/complete/retry/fail are fenced by the claim token and return `false`
  when the lease was lost (the runner then aborts); `saveCursor` is the heartbeat that extends the lease. Every kind is claimed (`full_import`, `reconcile`,
  `webhook`, `push_order`, `customer_import`); at most one open `customer_import` per connection and
  `payload.contactId` (none: the import), checked under an advisory lock (`customer-jobs.drizzle.ts`; no index). Idle open jobs of a disconnected connection are closed (`done_at`,
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
  each page, write batch and item upsert (`CatalogWriter.write`) the connection is re-read: disconnected →
  `ConnectionGoneError`, the job completes, and the links are released again unless the workspace has a
  live connection (a write may have landed after the disconnect's release). Jobs
  of a connection whose connect failed, and `webhook` jobs, complete with no work. Groups whose master is not
  in the page fetch it by id (a vanished master drops the group). Every upsert is `{ partial: true }`; product pages are read
  `orderBy=id` ascending (`PRODUCT_ORDER`); a full import that read every page in full, with the product
  `total` unchanged since its first page (`cursor.productTotal`), archives linked products and variants it
  did not see once `productById` confirms each is gone (at most `SWEEP_CAP` = 200 checked per run, the rest
  logged `sweep_capped {count}`), and the unlinked (Rapiz-only) variants left on linked products. Product pages are read without inventory
  (`includeInventory` off); stock comes from the on-hands phase. Pictures go
  through the image cache; failures are counted (`image_failed {count}` once per run). An item's link or
  code race (`CONFLICT`) is retried once, then logged `sku_conflict {sku}`, as is every skipped SKU. Success:
  `connected`, `progress` null, `lastError` null, `counts.products`, `lastReconcileAt` = run start (and
  `lastFullSyncAt`, `full_sync_done {products, images_failed}` for full runs); a sale-branch change during the
  run queues `reconcile {full: true}`. Errors: auth/retailer/permission (or a secret that no longer opens) →
  `error` + `lastError.code = 'auth_failed'`, `failJob`, `auth_failed` logged once; anything else retries at
  +1/+5/+30 min (by `attempts` = failures so far), then fails with `error` status and `kiotviet_unavailable` or `sync_failed`. A `false` from
  any fenced job write stops the job at once.
- Order push (spec §7, `application/order-push.ts`, `domain/kiotviet-order.ts`): every 15 s the tick
  reads the `connected|syncing` connections (`connectionsForPushScan`). One with `pushOrders` off only
  releases its pending claims older than 2 min (`releasePendingPushes(ws, 'kiotviet', olderThan)`). For one
  with push on it claims up to 20 orders
  (`claimOrdersForPush(ws, 'kiotviet', connection.createdAt, 20)`), adds pending orders whose claim is more
  than 2 min old and created since the connection (`stalePendingOrders`: a crash between claim and enqueue;
  orders of an earlier connection never come back), and enqueues one `push_order` job per order unless its
  newest job is still open (`latestPushJob`), with `payload { orderId, firstAttemptAt }`. At most one open push
  job per order is enforced by the unique index `integration_jobs_one_push_per_order` on `(workspace_id, payload ->> 'orderId')` (migration 0050):
  `enqueue` answers `false` on that conflict, so two workers scanning at once never queue a second job, and
  `integration_jobs_push_order_idx` serves the per-order lookup.
  When that newest job's cursor or payload says `ambiguous` (a "Thử lại" after a possibly delivered create),
  the new job inherits `ambiguous`, the original `firstAttemptAt` and the `branchId` tried. The job reads `pushableOrder` (null → complete); a problem marks the
  order failed (`unlinked_product {name}` or `empty_order`). Otherwise it saves the cursor
  `{ ambiguous: true, branchId }` and sends `kiotVietOrderBody` (branch `orderBranchId`, description `Rapiz <code>` +
  note, lines by KiotViet id, order discount, `customer`, `orderDelivery` whose price carries the shipping
  fee plus whatever Rapiz's total adds — the surcharge — so the KiotViet total equals Rapiz's); an attempt
  that finds `ambiguous` (cursor or payload) first reads the tried branch's orders modified since `firstAttemptAt − 1 min` (≤ 10 pages)
  and adopts the one whose description carries the code as a whole token (`carriesRapizCode`). Then
  `markOrderPushed` (status via `orderStatusOf`, `KV_ORDER_STATUS`), log `order_pushed {code}` (or
  `order_pushed_cancelled {code}` when Rapiz cancelled or deleted it meanwhile), `counts.ordersPushed =
pushedOrderCount`, then the stock refresh: `markOrderPushed` released the Rapiz hold, so the job re-reads
  each distinct line product (`productById`) and calls `setExternalStock` with
  `availableBySaleBranches(inventories, saleBranchIds)`, which now counts the order in KiotViet's
  `reserved` (no window in which the units are sellable twice; a failure only logs, the reconcile
  repairs). `KiotVietRejectedError` → `kiotviet_rejected`, `OrderAlreadyPushedError` → log
  `order_push_duplicate {code}` (staff cancel the extra KiotViet order), `OrderExternalLinkConflictError` → `kiotviet_link_conflict`:
  all complete without a retry. Other errors take the shared job path (`PushAttemptError` carries the order
  code): auth → connection `error` + order `auth_failed`; others retry +1/+5/+30 min, then the order fails
  with `kiotviet_unavailable`/`sync_failed` and the connection status is left alone; a job whose connection
  is gone (disconnected, connect failed) fails its order with `not_connected`. Every give-up logs
  `order_push_failed {code, reason}` (warning). Each reconcile with push on pages `GET /orders` of the order
  branch since the previous `lastReconcileAt` (else `createdAt`) − 2 min (≤ 20 pages) and applies every
  status (`reconcileStatuses`), repairing lost `order.update` deliveries; best effort. `disconnect` calls
  `releasePendingPushes` after the status write, so claimed orders go back to unclaimed; a settings save
  that turns `pushOrders` off does the same. A full import or reconcile writes `counts` from the latest
  connection, so it never undoes `ordersPushed`.
- Customers (spec §4.4, PR 3; `application/customer-sync.ts`, `application/contact-push.ts`,
  `domain/kiotviet-customer.ts`): KiotViet customer → `ExternalContactInput` (`contactOfKvCustomer`: id as
  text, the first number of `contactNumber`, address joined with ward and location, `gender` through
  `KV_CUSTOMER_GENDER`; the crm module normalizes). A settings save that turns `syncCustomers` on calls
  `releaseFailedContactPushes` and enqueues `customer_import`; turning it off calls
  `releasePendingContactPushes`. The `customer_import` job without `payload.contactId` is the full import:
  a fresh run releases failed pushes, then pages `GET /customers` (100, `orderBy=id`, cursor
  `{ currentItem, startedAt }` saved after every page, the connection re-read before every upsert; paging
  stops on `currentItem ≥ total`, never on a page that parsed empty), upserts
  each (`InvalidExternalContactIdError` / `ContactExternalLinkConflictError` skip the record, counted in the
  process log), unlinks the page's `removedIds`, then writes `counts.customers = linkedContactCount` and logs `customers_synced {count}`; with
  the switch off it completes with no work. A full import that gives up after its retries
  (`sync_failed` / `kiotviet_unavailable`) calls `CustomerSync.importFailed`: `customers_import_failed
  {reason}` unless the newest customer entry of the last 50 log entries already says so, connection status
  untouched (auth/retailer errors keep the connection-wide path). A `reconcile` with the switch on
  (`CustomerSync.reconcilePass`) reads customers modified since the customer watermark
  `counts.lastCustomerSyncAt` − 2 min (`includeRemoveIds`; removed ids
  unlink), heartbeating with the catalog's `finish` cursor; without a watermark it enqueues `customer_import`
  (deduped) instead. On success the watermark becomes the pass start
  (the import sets it to its own start); any failure except auth/store/lease/disconnect/no-database is
  process-logged and swallowed so the catalog reconcile commits, and the watermark stays. The import's and
  the pass's `live()` also throw `CustomerSyncOffError` once the switch is off: the work stops quietly (job
  completed, reconcile committed). A `KiotVietPermissionError` (403) in the import, the pass or a push job calls
  `disableCustomerSync` (`customer-switch.ts`): `settings.syncCustomers = false` against the version read
  (an owner field, so `version` bumps), `releasePendingContactPushes`, `customers_permission_missing` logged
  once; the job completes and the connection status is untouched. On the order path
  (`customerIdForOrder`) a 403 calls it too and the order goes inline. The connection is re-read once per page. `customer.update` re-reads each id (`customerById`; gone → unlink), `customer.delete` unlinks;
  both are ignored while the switch is off. Every unlink for a KiotViet delete (webhooks, `removedIds`)
  goes through `unlinkExternalContacts`, which marks the customer `detached` in the crm module: never
  claimed for a push again until an import links it. The push scan (30 s) claims up to 20 customers created since the
  connection (`claimContactsForPush`) plus pending ones claimed > 2 min ago (`staleContactPushes`) and
  enqueues one `customer_import {contactId}` each (switch off: `releasePendingContactPushes(olderThan
  2 min)`). The push job reads `pushableContact` (null with the switch on → `markContactPushFailed('not_pushable')`,
  silent, so an archived or phone-less pending customer is not re-queued forever; the crm stale sweep also
  skips them), looks KiotViet up by phone
  (`customersByPhone` with the local number, hits re-checked with `matchesPhone`, lowest id wins) and adopts
  it, else heartbeats and sends `POST /customers` (once-mode, order branch), then `markContactPushed`;
  `ContactAlreadyLinkedError` / `NOT_FOUND` complete, `KiotVietRejectedError` → `kiotviet_rejected`,
  `ContactExternalLinkConflictError` → `link_conflict` (failed at once); other errors take the shared retry
  path, and a give-up marks the customer failed with the code and leaves the connection status alone (auth
  errors still set the connection `error`). Every failure logs `customer_push_failed {reason}`, once per connection and reason between two scans. A failed
  customer stays failed until a full customer import or the switch turned off and on. Order push: while
  `syncCustomers` is on, `OrderPusher` asks `ContactPusher.customerIdForOrder` (buyer phone → KiotViet
  customer found or created) and sends `customerId` instead of the inline `customer`; no usable phone or any
  failure falls back to the inline customer (never blocks the order). Orders carry no CRM contact id, so
  `externalIdOf` is not used. A disconnect seen by a job or webhook also re-releases the CRM links unless a
  new connection is live (`CustomerSync.releaseIfDisconnected`).
- Webhook deliveries: signature = HMAC-SHA256 keyed by the registered secret text (`webhookSigningKey`, one
  line to change); bad → dropped, `webhook_bad_signature` logged once per connection per process (the
  process log counts them, warning at the 1st and every 100th). A disconnect seen while applying (per item,
  and once more after the last) releases the links again, as for jobs. `Notifications[].Action` loses its retailer
  suffix; `product.update` / `stock.update` re-read the products by id (never the payload) and upsert the
  group / set stock from their inventories; `product.delete` archives the `RemoveId`s; `customer.update` / `customer.delete` go to `CustomerSync`;
  `order.update` re-reads each order (`orderById`) and calls
  `applyExternalOrderStatus` (an order Rapiz did not push answers `unknown`: ignored); other actions log
  `webhook_unknown {type}` once per type and process.
- Never log secrets, tokens or customer data: log codes and counts (rule 07).

**Do not:** read `commerce`/`crm` tables (use their facades); put HTTP, Zod or Drizzle types in `domain/`.

**Test:** `pnpm --filter @agent-sales/backend test -- integration` (unit and HTTP, fake KiotViet in
`__tests__/fake-kiotviet.ts`, routes in `test/integration-http.spec.ts`; order push in
`__tests__/order-push.spec.ts`, `__tests__/kiotviet-client-orders.spec.ts`, `domain/kiotviet-order.spec.ts`;
customers in `__tests__/customer-sync.spec.ts`, `__tests__/connection-customers.spec.ts`,
`__tests__/kiotviet-client-customers.spec.ts`, `domain/kiotviet-customer.spec.ts`, with the CRM fake
`__tests__/memory-contacts.ts`) · Postgres (Testcontainers, needs
Docker): `pnpm --filter @agent-sales/backend test:integration -- integration`, covering
`__tests__/integration-store.integration.spec.ts`, `__tests__/sync.integration.spec.ts` (incl. an order push
whose first answer is lost, then a KiotViet cancellation, and customers both ways) and
`test/integration-tables.integration.spec.ts` (RLS) · webhook ingress: `pnpm --filter @agent-sales/webhook test`.
