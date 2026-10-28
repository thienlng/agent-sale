# commerce

**Purpose:** the shop's catalog and orders — warehouses, products with variants, inventory with a movement log, orders with items, status flow and history, order settings, and the sales overview (docs/02 ORD-01..05, ORD-11).

**Owned tables:** `warehouses`, `products`, `product_variants`, `inventory`, `inventory_movements`, `order_counters`, `orders`, `order_items`, `order_status_history`, `order_settings`, `bot_products` (tenant, forced RLS — migrations 0004, 0005, 0014 and 0029; schema in `packages/db/src/schema/commerce.ts`).

**Public API (`api/`):** `COMMERCE_FACADE` → `getOrder(workspaceId, orderId)`; `CATALOG_FACADE` → `getBotProducts(workspaceId, bot, query, limit)` and `listBotCatalog(workspaceId, bot, limit)` (read-only, active and `visibleToBot` only, with `imageUrls`; `bot` is `{ botId, catalogMode }` and `selected` restricts to the bot's selection, T-080). HTTP (workspace-scoped): `/warehouses`, `/products`, `/products/{id}/stock`, `/product-variants`, `/bots/{botId}/products` (GET; PUT replaces the selection, `catalog.manage`; a bot or product of another workspace is 404), `/orders`, `/orders/overview`, `/orders/{id}`, `/orders/{id}/status`, `/order-settings`. Contracts: `packages/contracts/src/commerce/`.

**Events consumed:** none. Uses the `identity` facade (name snapshots) and the `workspace` facade (time zone).

**Invariants:**

- Money is integer VND; amounts follow docs/05 §6 exactly (`computeAmounts` in `packages/shared`, shared with the order form; unit-tested). `gross` ("Tổng số tiền") is before the discount, `total` ("Tiền cần thu") after it.
- Lines can be edited (`PATCH /orders/{id}` with `items`) only while the order holds its goods (`stock_state = reserved`); otherwise 409 and nothing changes. The reservation moves by the per-variant difference (`reservationChanges`); a variant already on the order keeps its snapshot (names, cost, price unless a new price is sent), a new variant must be on sale and takes the catalog price.
- Source field policies (`order-rules.ts`): saving an order checks its source's `create` fields; creating it in, or moving it into, a fulfilment status also checks the `confirm` fields; editing the people of an order re-checks the stage it is in. Settings saves carry `version` (stale → 409).
- Stock follows the order (`domain/order-stock.ts`): a live order holds its goods (`reserved`), the first shipped status (delivering, delivered, delivery failed, returning) takes them out, `cancelled` gives held goods back, goods already out can only come back as `returned`. Every change writes `inventory_movements`.
- Concurrency: edits and status changes lock the order row (`SELECT … FOR UPDATE`), stock-takes lock the inventory row; held stock is never clamped, so a negative hold fails the CHECK constraint instead of hiding a bug.
- Creating an order is idempotent per `clientRequestId` (one per form draft): a retry or double submit returns the first order.
- Overselling is allowed on purpose (pre-orders, shops that do not track stock): orders may take more than `on_hand − reserved`; the order form warns per line. Revisit if a shop needs a hard limit (owner decision).
- Products carry up to 5 `imageUrls` (https only, 2000 characters each; migration 0014, `products.image_urls`); they are returned by `getBotProducts` so the bot can send them (the AI module builds the allowlist, never the URLs into the prompt). `botProductSearches` (`domain/bot-product-search.ts`) turns a customer message into catalog search terms (ignores picture-request filler, max 8 terms).
- Search treats `%`, `_` and `\` literally.
- Order codes are `DH` + 6 digits, incrementing per workspace (`order_counters`, row-locked by the upsert).
- Optional statuses (awaiting print, printed) can only be used when switched on in order settings; statuses listed as "require note" reject a change without a note.
- Variants are archived, never deleted (past orders reference them); SKUs and product codes are unique per workspace, case-insensitive.
- Overview figures are per local day in the workspace time zone and use the same rows as the order list (sales = all but cancelled; revenue/profit/closed = `CLOSED_ORDER_STATUSES`).
- Names of who created/changed an order are snapshotted (the `users` table is global).

**Do not:** read other modules' tables; compute money with floats; update `inventory` without a movement; delete orders or variants.

**No database:** routes answer 503 `UNAVAILABLE` (the SQL search and aggregates have no faithful in-memory fake). Test with `test/commerce.integration.spec.ts`.

**Test:** `pnpm --filter @agent-sales/backend test -- commerce` · integration: `test/commerce.integration.spec.ts`
