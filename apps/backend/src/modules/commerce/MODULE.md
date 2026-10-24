# commerce

**Purpose:** the shop's catalog and orders — warehouses, products with variants, inventory with a movement log, orders with items, status flow and history, order settings, and the sales overview (docs/02 ORD-01..05, ORD-11).

**Owned tables:** `warehouses`, `products`, `product_variants`, `inventory`, `inventory_movements`, `order_counters`, `orders`, `order_items`, `order_status_history`, `order_settings` (tenant, forced RLS — migration 0004; schema in `packages/db/src/schema/commerce.ts`).

**Public API (`api/`):** `COMMERCE_FACADE` → `getOrder(workspaceId, orderId)`. HTTP (workspace-scoped): `/warehouses`, `/products`, `/products/{id}/stock`, `/product-variants`, `/orders`, `/orders/overview`, `/orders/{id}`, `/orders/{id}/status`, `/order-settings`. Contracts: `packages/contracts/src/commerce/`.

**Events consumed:** none. Uses the `identity` facade (name snapshots) and the `workspace` facade (time zone).

**Invariants:**

- Money is integer VND; amounts follow docs/05 §6 exactly (`computeAmounts` in `packages/shared`, shared with the order form; unit-tested). Items are immutable after creation; edits recompute payment/shipping amounts only.
- Stock follows the order (`domain/order-stock.ts`): a live order holds its goods (`reserved`), the first shipped status (delivering, delivered, delivery failed, returning) takes them out, `cancelled` gives held goods back, goods already out can only come back as `returned`. Every change writes `inventory_movements`.
- Concurrency: edits and status changes lock the order row (`SELECT … FOR UPDATE`), stock-takes lock the inventory row; held stock is never clamped, so a negative hold fails the CHECK constraint instead of hiding a bug.
- Creating an order is idempotent per `clientRequestId` (one per form draft): a retry or double submit returns the first order.
- Overselling is allowed on purpose (pre-orders, shops that do not track stock): orders may take more than `on_hand − reserved`; the order form warns per line. Revisit if a shop needs a hard limit (owner decision).
- Search treats `%`, `_` and `\` literally.
- - Order codes are `DH` + 6 digits, incrementing per workspace (`order_counters`, row-locked by the upsert).
- Optional statuses (awaiting print, printed) can only be used when switched on in order settings; statuses listed as "require note" reject a change without a note.
- Variants are archived, never deleted (past orders reference them); SKUs and product codes are unique per workspace, case-insensitive.
- Overview figures are per local day in the workspace time zone and use the same rows as the order list (sales = all but cancelled; revenue/profit/closed = `CLOSED_ORDER_STATUSES`).
- Names of who created/changed an order are snapshotted (the `users` table is global).

**Do not:** read other modules' tables; compute money with floats; update `inventory` without a movement; delete orders or variants.

**No database:** routes answer 503 `UNAVAILABLE` (the SQL search and aggregates have no faithful in-memory fake). Test with `test/commerce.integration.spec.ts`.

**Test:** `pnpm --filter @agent-sales/backend test -- commerce` · integration: `test/commerce.integration.spec.ts`
