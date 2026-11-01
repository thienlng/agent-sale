# PMS integration ("Tích hợp PMS") with KiotViet — design

Status: approved in chat by the owner on 2026-11-01 ("Để tên là Tích hợp PMS hay hơn nhé. Rồi triển thôi").
Requires ADR-017 (an external system is the source of truth for linked catalog and customer data).

## 1. Goals

Many Rapiz customers run their shop on KiotViet and ask "can Rapiz connect to our PMS?". After this work:

1. An owner connects their KiotViet store in a few minutes, without help, from a "Tích hợp PMS" page.
2. The bot sells from the KiotViet catalog: names, prices, pictures and the stock of the branches the shop
   sells online from, kept fresh within seconds (webhooks) and never more than ~10 minutes stale (reconcile).
3. Orders the bot closes (after staff approval) and orders staff create in Rapiz land in KiotViet as
   orders of the chosen branch; their KiotViet status comes back.
4. KiotViet customers appear in the Rapiz CRM (matched by phone), and new Rapiz customers with a phone are
   created in KiotViet.

Non-goals (this design): Sapo, Haravan, Pancake POS (the page shows them as "Sắp có"); invoices, payments,
returns, price books other than the base price, promotions/vouchers, two-way product editing, editing a
pushed order in Rapiz, multiple KiotViet stores per business.

## 2. Owner decisions (2026-11-01)

| Topic | Decision |
|---|---|
| Scope | Products + stock, order push, customers ("Đủ cả khách hàng"). |
| Source of truth | KiotViet. Linked product fields are read-only in Rapiz with a "Sửa trên KiotViet" hint; Rapiz-only bot settings stay editable. |
| Branches | The owner ticks the branches used for online sales; stock = sum over those branches of (on hand − reserved). One of them receives pushed orders. |
| Where it lives | A new top-level sidebar item **"Tích hợp PMS"** (`/app/integrations`), separate from "Tích hợp nền tảng" (chat channels only). Contextual entry points on Products, Orders and Customers. |
| Delivery | Three PRs from one worktree (`feat/pms-kiotviet`): (1) connection + page + catalog/stock sync, (2) order push, (3) customers. |

## 3. KiotViet API facts we rely on

From the public API guide (https://www.kiotviet.vn/huong-dan-su-dung-public-api-retail/):

- **Credentials**: the store admin opens *Thiết lập cửa hàng → Thiết lập kết nối API*, gets a **Client ID** and a
  **Mã bảo mật** (client secret), and ticks the permission to read customers/invoices/orders. The **Retailer**
  is the store name (the subdomain of `<retailer>.kiotviet.vn`).
- **Token**: `POST https://id.kiotviet.vn/connect/token`, form body `scopes=PublicApi.Access`,
  `grant_type=client_credentials`, `client_id`, `client_secret` → `{ access_token, expires_in: 86400, token_type: "Bearer" }`.
- **Calls**: base `https://public.kiotapi.com`, headers `Retailer: <name>` and `Authorization: Bearer <token>`.
- **Pagination**: `pageSize` (≤ 100), `currentItem` (offset); incremental reads with `lastModifiedFrom`;
  `includeRemoveIds=true` returns deleted ids (`removeId` on products, `removedIds` on other lists).
- **Limit**: 5 000 requests per hour per store.
- **Endpoints used**: `GET /branches`, `GET /categories`, `GET /products` (`includeInventory`, `includeRemoveIds`,
  `lastModifiedFrom`), `GET /productOnHands` (`branchIds`, `lastModifiedFrom`), `GET/POST /customers`,
  `GET /customers?contactNumber=`, `POST /orders`, `GET /orders/{id}`, `POST/GET/DELETE /webhooks`.
- **Product fields**: `id, code, name, fullName, categoryId, categoryName, allowsSale, hasVariants,
  masterProductId, masterUnitId, unit, conversionValue, attributes[{attributeName, attributeValue}],
  basePrice, weight, images: string[], description, inventories[{branchId, onHand, reserved}], modifiedDate`.
- **Webhooks**: `POST /webhooks` with `{ Webhook: { Type, Url, IsActive, Description, Secret } }` (secret ≥ 8
  chars, base64-encoded), one per event type. Delivery body `{ Id, Attempt, Notifications: [{ Action, Data }] }`,
  signed with HMAC-SHA256 of the body in `X-Hub-Signature`. Must answer within 5 s. **A 400/401/403/404/405
  answer makes KiotViet stop calling that URL**, so we answer those only when we really want it to stop.
  Types used: `product.update`, `product.delete`, `stock.update`, `order.update`, `customer.update`,
  `customer.delete`, `category.update`, `branch.update`, `branch.delete`.

Field names the guide does not show (webhook `Data` shapes, order status codes) are confirmed against a real
trial store before each PR merges; the client parses them with tolerant Zod schemas and logs unknown shapes.

## 4. Architecture

### 4.1 Module `integration` (new, tier 3 — flows)

Created with `pnpm gen module integration`. It depends on the `commerce` and `crm` facades (and `workspace`
for the time zone); nothing depends on it. One provider today (`kiotviet`), shaped so Sapo/Haravan can be
added as more providers later without changing callers.

- `domain/` — pure: mapping KiotViet products → a Rapiz catalog item (§5.1), stock aggregation (§5.2),
  connection status rules, webhook signature check, sync cursor rules.
- `application/` — `ConnectionService` (test, connect, update settings, disconnect), `SyncService`
  (full import, incremental reconcile, webhook processing, order push, customer sync), `SyncRunner` (the tick).
- `infrastructure/clients/kiotviet-client.ts` — token cache (refresh 5 min before `expires_in`), per-store
  request budget (token bucket: 4 500/h, bursts of 10), retries with backoff on 429/5xx, typed responses (Zod).
- `infrastructure/persistence/` — its own tables (§4.3).
- `interface/http/integration.controller.ts` — the HTTP API (§4.5).

### 4.2 Background work (no BullMQ)

The repo has no BullMQ consumers yet; background work uses Postgres leases and ticks (channel ingress,
analytics projector). The integration follows that pattern:

- Table `integration_jobs` (lease-claimed with `FOR UPDATE SKIP LOCKED`, `lease_until`, `attempts`,
  `failed_at` dead letter, `run_after` for backoff). Kinds: `full_import`, `reconcile`, `webhook`,
  `push_order`, `customer_import`. At most one `full_import`/`reconcile` per connection at a time
  (partial unique index on open jobs).
- The **worker** entry imports `IntegrationModule` and runs `SyncRunner.tick()` every 2 s (next to the
  analytics tick). The tick also enqueues a `reconcile` for every connection whose last one is older than
  10 minutes, and a `push_order` scan every 15 s (§7).
- A full import is resumable: its cursor (`entity`, `currentItem`) is saved after each page, so a restart
  continues where it stopped.

### 4.3 Tables (migration `0040_pms_integration.sql`, tenant tables with forced RLS)

`integration_connections` — one per workspace and provider:
`id, workspace_id, provider ('kiotviet'), status ('connected' | 'syncing' | 'error' | 'disconnected'),
retailer, client_id, client_secret_sealed (SecretBox), webhook_token (random 32 bytes, base64url, unique),
webhook_secret_sealed, settings jsonb ({ saleBranchIds: number[], orderBranchId: number, pushOrders: bool,
syncCustomers: bool }), last_full_sync_at, last_reconcile_at, last_error jsonb ({ code, message, at }),
counts jsonb ({ products, customers, ordersPushed }), connected_by_user_id, created_at, updated_at,
disconnected_at`. Partial unique `(workspace_id, provider) where status <> 'disconnected'`.

`integration_jobs` — as §4.2, with `connection_id`, `kind`, `payload jsonb`, `cursor jsonb`.

`integration_webhook_events` — raw deliveries written by `apps/webhook`:
`id, workspace_id, connection_id, delivery_id (KiotViet Id), body text, signature text, received_at,
processed_at`. Unique `(connection_id, delivery_id)`. An insert trigger enqueues nothing; the tick picks
unprocessed rows.

`integration_image_cache` — `workspace_id, source_url, stored_url, created_at`, primary key
`(workspace_id, source_url)`: each KiotViet picture is downloaded once.

`integration_sync_log` — the last 200 notable events per connection (errors and summaries) for the page:
`id, workspace_id, connection_id, level ('info' | 'warning' | 'error'), code, message_key, params jsonb, at`.

Owned by `commerce` (migration adds columns, backward compatible, all nullable):
- `products.external_source text, products.external_id text`, unique `(workspace_id, external_source, external_id)`.
- `product_variants.external_id text`, unique `(workspace_id, external_id)` where not null
  (`external_source` is the product's).
- `orders.external_source, external_id, external_code, external_status, external_state
  ('pending' | 'pushed' | 'failed' | null), external_error jsonb, external_pushed_at`.

Owned by `crm`: `contacts.external_source text, contacts.external_id text`, unique per workspace.

### 4.4 Facades the integration calls (new methods)

`commerce` — new `CATALOG_SYNC_FACADE` (`api/catalog-sync.facade.ts`), system-of-record writes only:
- `upsertExternalProduct(ws, source, item, { partial? })` — creates or updates one product with its variants
  by external ids. Without `partial`, variants of that product missing from `item` are archived. With
  `partial: true` (what the integration always sends, because a page or a webhook may carry only part of a
  KiotViet group) only the variants it names are touched: the others stay live, in their order, and new ones
  follow. Rapiz-only fields (`visibleToBot`, `botInstructions`, bot selection) are never overwritten.
  Matching an existing Rapiz product the first time: by variant SKU = KiotViet `code` (case-insensitive).
- `removeExternalProducts(ws, source, externalIds)` — archives the linked products whose own external id is
  listed and the linked variants whose external id is listed (KiotViet deletes single variants too).
- `linkedExternalIds(ws, source)` and `archiveUnlinkedVariants(ws, source)` — the sweep at the end of a full
  import that read every page: linked products and variants it did not see are archived through
  `removeExternalProducts`, and the live variants without an external id left on linked products (Rapiz-only
  variants of an adopted product) are archived, since staff cannot edit the variants of a linked product.
- `setExternalStock(ws, source, [{ externalVariantId, available }])` — sets `on_hand = available` at the
  default warehouse, writing an `adjust` movement with `ref_type = 'kiotviet'` when it changes.
- `importExternalImage(ws, url)` — downloads into Rapiz storage with the existing `downloadImage` rules
  (SSRF check, 10 MiB, JPEG/PNG only) and returns the stored URL.
- `releaseExternalSource(ws, source)` — on disconnect: clears the link columns so products become ordinary
  Rapiz products (editable), keeping all data.
- Order push (PR 2): `ordersAwaitingPush(ws, since, limit)`, `markOrderPushed(ws, orderId, ref)`,
  `markOrderPushFailed(ws, orderId, error)`, `applyExternalOrderStatus(ws, source, externalId, status)`.

`crm` — `upsertExternalContact(ws, source, contact)` (match by external id, then by normalized phone, else
create with source "KiotViet"), `removeExternalContacts`, `contactsAwaitingPush(ws, since, limit)`,
`markContactPushed(ws, contactId, externalId)`, `releaseExternalSource(ws, source)`.

### 4.5 HTTP API (`packages/contracts/src/integration/`), workspace-scoped

| Route | Capability | Purpose |
|---|---|---|
| `GET /integrations` | `catalog.manage` | Providers with their state (KiotViet: connection summary or `null`; others `comingSoon`). |
| `POST /integrations/kiotviet/test` | `settings.manage` | `{ retailer, clientId, clientSecret }` → token + `GET /branches`; answers `{ branches, preview: { matched, created, rapizOnly } }` or a typed error (§8). Stores nothing. |
| `POST /integrations/kiotviet` | `settings.manage` | Connect: credentials + settings; seals the secret, registers webhooks, enqueues `full_import`. |
| `PATCH /integrations/kiotviet` | `settings.manage` | Change branches/toggles (`version` for stale edits); a branch change enqueues `reconcile`. |
| `POST /integrations/kiotviet/sync` | `settings.manage` | "Đồng bộ ngay": enqueues `reconcile` (409 if one is running). |
| `GET /integrations/kiotviet/log` | `catalog.manage` | Last 200 log rows. |
| `DELETE /integrations/kiotviet` | `settings.manage` | Disconnect: deletes webhooks at KiotViet (best effort), releases external links, status `disconnected`. |

The client secret is never returned; the API answers `clientIdMasked` (last 4 characters).

### 4.6 Webhook ingress (`apps/webhook`)

New route `POST /webhooks/kiotviet/:token` (thin, no business logic): look up the connection by
`webhook_token` (unknown or disconnected → **410**, KiotViet then stops calling a dead URL), insert the raw
body + signature into `integration_webhook_events` (`on conflict do nothing`), answer 200. The signature is
checked by the worker, which can open the sealed secret; a bad signature is logged and the event dropped.
The unguessable token keeps strangers from filling the table; body size is capped at 1 MiB.

## 5. Catalog and stock

### 5.1 Mapping

- A KiotViet product with `masterProductId = null` and no `masterUnitId` is a **master**. Every master
  becomes one Rapiz product (`external_id = master id`).
- The master and its attribute variants (`masterProductId = master`) and its other units
  (`masterUnitId = master`) become Rapiz variants (`external_id = KiotViet id`, `sku = code`).
  Variant name: attribute values joined by " / ", plus the unit when the product has several units.
- `name` ← master `name`; `description` ← `description` (HTML stripped); `category` ← `categoryName`;
  `price` ← `basePrice` (VND, integer); `weight_gram` ← `weight`; `status` ← `active` when
  `allowsSale` and not deleted, else `archived`.
- Pictures: the master's `images` (first 5), each imported once into Rapiz storage and remembered by source
  URL in `integration_image_cache (workspace_id, source_url, stored_url)`. WebP or failed downloads are
  skipped and logged ("3 ảnh không tải được").
- Rapiz products that existed before the connection and match no KiotViet code stay Rapiz-only and editable.

### 5.2 Stock

`available(variant) = Σ over saleBranchIds of (onHand − reserved)`, floored at 0, written with
`setExternalStock`. Rapiz `inventory.reserved` keeps holding the goods of Rapiz orders not yet in KiotViet,
so the bot sees `available − Rapiz holds`. When an order reaches KiotViet (PR 2) its Rapiz hold is released,
because KiotViet's own `reserved` now covers it.

### 5.3 Freshness

- **Full import** on connect: branches → categories → products (with inventories) page by page; about
  `products/100 + 5` calls, so a 5 000-product store takes ~55 calls.
- **Webhooks**: `product.update` / `product.delete` / `stock.update` upsert just those products or stock rows.
- **Reconcile** every 10 minutes and on "Đồng bộ ngay": products and on-hands with
  `lastModifiedFrom = last_reconcile_at − 2 min`, plus `includeRemoveIds`.

### 5.4 Locked fields

`CatalogService.updateProduct` and `adjustStock` reject changes to linked fields of a product with
`external_source` set: name, description, category, pictures, status, variants (sku, name, price, cost,
weight, add/remove) and stock → 409 `CONFLICT` with `details.reason = 'EXTERNAL_SOURCE'` and `field`.
`visibleToBot`, `botInstructions` and the bot selection stay editable. Deleting a linked product is refused
the same way.

## 6. UI/UX

### 6.1 Navigation

Sidebar: new item **"Tích hợp PMS"** (`/app/integrations`, icon `Blocks`) right after "Sản phẩm"; for a
hotel business (no products), after "Tích hợp nền tảng". Visible to roles with `catalog.manage`.

### 6.2 `/app/integrations` — hub

Header "Tích hợp PMS" + one line "Kết nối phần mềm quản lý bán hàng để bot tư vấn đúng giá và tồn kho, đơn
chốt tự vào phần mềm của bạn." A grid of provider cards (logo, name, one-line value, state):
KiotViet → "Kết nối" (primary) or its status badge; Sapo, Haravan, Pancake POS → disabled "Sắp có".

### 6.3 Connect wizard (`/app/integrations/kiotviet`, 3 steps with a step indicator, back allowed)

1. **Thông tin kết nối** — fields with visible labels and helper text: Tên gian hàng (with `.kiotviet.vn`
   suffix shown, accepts a pasted URL and extracts the name), Client ID, Mã bảo mật (show/hide toggle).
   A collapsible "Lấy mã ở đâu?" lists the 4 steps in KiotViet (with link to the KiotViet guide).
   Primary button "Kiểm tra kết nối" (loading state). Errors appear under the field they concern (§8).
2. **Chi nhánh** — checkbox list of branches (name, address) "dùng để bán online" (all ticked when there is
   one branch, none pre-ticked otherwise; at least one required), then a select "Chi nhánh nhận đơn" among the
   ticked ones.
3. **Xem trước & bắt đầu** — the preview counts: "120 sản phẩm khớp theo mã · 30 sản phẩm mới · 5 sản phẩm chỉ
   có trên Rapiz (giữ nguyên)"; switches "Đẩy đơn sang KiotViet" and "Đồng bộ khách hàng" (on by default, shown
   as "Sắp có" until PR 2/3 ship); a note that KiotViet becomes the source of truth for linked products.
   Button "Bắt đầu đồng bộ".

Then the page becomes the connection view with a progress card ("Đang nhập sản phẩm 300/1 240") that updates
by polling every 3 s while syncing; the owner may leave.

### 6.4 Connection view (same route when connected)

- Status header: badge (Đã kết nối / Đang đồng bộ / Lỗi — icon + text, not colour alone), store name,
  "Đồng bộ lần cuối 2 phút trước", button "Đồng bộ ngay".
- Stat tiles: Sản phẩm liên kết, Khách hàng, Đơn đã đẩy (tabular numbers).
- Settings card: branches, order branch, toggles (edit inline, save with feedback).
- Activity list: recent log rows; each error has a cause and a fix ("Mã bảo mật đã bị đổi trên KiotViet →
  Cập nhật mã").
- Danger zone: "Ngắt kết nối" with a confirmation dialog explaining that data stays and products become
  editable in Rapiz.

### 6.5 Contextual entry points

- Products list: when not connected and the business sells products, a dismissible hint card "Đang dùng
  KiotViet? Nhập sản phẩm tự động" → hub. When connected: a slim bar "Đồng bộ với KiotViet · 2 phút trước",
  a "KiotViet" badge on linked rows, and a filter "Nguồn: KiotViet / Rapiz".
- Product form of a linked product: locked fields use the read-only style (not the disabled style) with a
  lock icon and a hint "Sửa trên KiotViet" linking to `https://<retailer>.kiotviet.vn`; the bot section stays
  editable.
- Orders (PR 2): a "KiotViet" column state chip (Đang đẩy / Đã đẩy DH000123 / Lỗi + "Thử lại").
- Customers (PR 3): a "KiotViet" badge on linked customers.

All strings in `packages/i18n` (new file `integration.json`, vi + en). Layout must keep `e2e/responsive.spec.ts`
green; touch targets ≥ 44 px; focus moves to the first invalid field after a failed step.

## 7. Orders (PR 2)

- Pushed when `pushOrders` is on: bot orders once approved and past the 5 s undo window; staff orders when
  created. Only orders created after the connection, and only when every line is a linked variant;
  otherwise the order is marked `failed` with "Sản phẩm X không có trên KiotViet".
- `POST /orders` to KiotViet: `branchId = orderBranchId`, `purchaseDate`, `description` (Rapiz code + note),
  `orderDetails[{ productId, productCode, quantity, price, discount }]`, order discount, `customer` (found by
  phone or created, PR 3 rules), `orderDelivery` (receiver, phone, address, shipping fee), `saleChannelId`
  omitted. Idempotency: the Rapiz order code goes into `description`; after an ambiguous failure (timeout,
  5xx) the retry first lists KiotViet orders of that branch with `lastModifiedFrom` = the first attempt time
  and adopts the one whose description carries the code, so a retry never creates a duplicate.
- On success: `markOrderPushed` stores `external_id/code/status`, releases the Rapiz hold and sets
  `stock_state = 'external'` (new state: later status changes move no Rapiz stock).
- `order.update` webhooks update `external_status`; a cancellation in KiotViet cancels the Rapiz order
  (history "Đơn đã huỷ trên KiotViet").
- Failures retry with backoff (1 min, 5 min, 30 min), then stay `failed` with a "Thử lại" action
  (`POST /orders/{id}/external-push`).

## 8. Errors and states

| Case | What the user sees |
|---|---|
| Token call 400/401 (`invalid_client`) | Under Client ID / Mã bảo mật: "Client ID hoặc mã bảo mật không đúng. Kiểm tra lại trong KiotViet → Thiết lập kết nối API." |
| Retailer unknown (calls 401/404 with a valid token) | Under Tên gian hàng: "Không tìm thấy gian hàng này. Tên gian hàng là phần trước .kiotviet.vn." |
| Missing permission (403 on customers/orders) | Step 1 banner listing what to tick in KiotViet. |
| Secret rotated later (401 during sync) | Status "Lỗi", log entry, button "Cập nhật mã"; jobs pause until fixed. |
| Rate limited (429) | Jobs back off silently; log "KiotViet đang giới hạn lượt gọi, sẽ thử lại". |
| KiotViet down / timeout | Retry with backoff; status stays "Đã kết nối" unless it lasts > 1 h. |
| Picture failed | Product synced without that picture; one aggregated warning per run. |

The client never logs secrets, tokens or customer data (rule 07): log entries carry codes and counts.

## 9. Security

- Secrets sealed with `SecretBox` (`SECRETS_ENCRYPTION_KEY`), never returned or logged.
- Webhook: unguessable path token + HMAC-SHA256 check (timing-safe) in the worker; 1 MiB cap.
- Picture downloads keep the SSRF and size rules of `downloadImage`.
- Only `settings.manage` may connect, change or disconnect; `catalog.manage` may view.
- Tenant isolation: every table has `workspace_id` with forced RLS; the worker uses the system role only to
  claim jobs and webhook rows, then runs each job inside `withTenant`.

## 10. Testing

- Domain unit tests: product mapping (masters, attribute variants, units, deleted, no images), stock
  aggregation, signature check, cursor resume.
- Client tests against a fake KiotViet server (Fastify in-process) covering token refresh, pagination,
  429 backoff, 401 handling.
- Integration tests (real Postgres): connect → full import → webhook update → reconcile → locked-field 409 →
  disconnect releases links; tenant isolation of every new table.
- Web: component tests for the wizard steps and errors; Playwright e2e for connect → connected view
  (mocked API), at 375/768/1280 px; `responsive.spec.ts` stays green.
- Manual: a KiotViet trial store before each PR merges.

## 11. Delivery

| PR | Content |
|---|---|
| 1 | Module, migration, client, connection API, full import + webhooks + reconcile for products/stock, locked fields, hub + wizard + connection view, sidebar item, products badges/bar/hint, docs + ADR-017. |
| 2 | Order push and status back, orders chip and retry, `stock_state = 'external'`. |
| 3 | Customer import, webhook and push, CRM badge. |

Docs updated with the code: `docs/07-channel-integrations.md` (KiotViet row), `docs/02-functional-requirements.md`
(ORD-15), `docs/03-screens-and-routes.md` (new route and sidebar item), `docs/05-data-model.md`,
`docs/ARCHITECTURE.md` §3 (tier 3 row), new `docs/integrations/kiotviet.md` (setup, data flow, limits),
`apps/backend/src/modules/integration/MODULE.md`, commerce and crm `MODULE.md`.
