# PMS integration with KiotViet — PR 2 (order push) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orders closed in Rapiz land in KiotViet: approved bot orders (past the 5 s undo window) and staff
orders created after the connection are pushed as KiotViet orders of the connection's order branch; their
KiotViet status comes back, and a cancellation in KiotViet cancels the Rapiz order.

**Architecture:** `commerce` gains order-push facade methods (claim, details, mark pushed/failed, requeue,
apply external status) and a new stock state `external`. `integration` scans claimable orders on the
worker tick, pushes each through a `push_order` lease job (existing retry schedule +1/+5/+30 min, then
`failed`), resolves ambiguous failures by matching the Rapiz code in KiotViet order descriptions, and
applies `order.update` webhooks. The web shows a KiotViet chip with "Thử lại" on orders and enables the
"Đẩy đơn sang KiotViet" switch.

**Tech Stack:** as PR 1 (NestJS, Drizzle, Zod contracts, React + TanStack, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-01-pms-kiotviet-design.md` §7 (orders), §4.4, §8; ADR-017.
Builds on PR 1 (#104, branch `feat/pms-kiotviet`); this branch `feat/pms-kiotviet-orders` is stacked on it.

## Global Constraints

- Worktree `/home/kenknight/Workspace/agent-sale-kiotviet`, branch `feat/pms-kiotviet-orders`. Never touch `/home/kenknight/Workspace/agent-sale`. Don't bind ports 3000/3001/4000/5173.
- Repo rules: `AGENTS.md`, `.agents/rules/*.md`, `docs/ARCHITECTURE.md`. English code/comments/commits; Vietnamese only in i18n vi files. Conventional Commits with a lowercase subject start, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Docs change with the code (rule 06).
- `integration` imports only `modules/commerce/api/**`; commerce never imports integration. `@Inject(TOKEN)` on every constructor parameter.
- One additive migration, `packages/db/migrations/0050_order_push.sql` (numbered 0050 to stay clear of the lodging series 0041–0049; PMS PR 3 takes 0051): `external` in `orders_stock_state_check`, unique `orders_external (workspace_id, external_source, external_id)`, `orders_push_unclaimed_idx`, `orders_push_pending_idx`, `integration_jobs_push_order_idx` and unique `integration_jobs_one_push_per_order (workspace_id, payload ->> 'orderId')` for open push jobs. The order columns themselves exist since 0040 (`orders.external_source, external_id, external_code, external_status, external_state ('pending'|'pushed'|'failed'), external_error jsonb, external_pushed_at`), and `integration_jobs.kind` already allows `push_order`.
- Money integer VND. Never log secrets, tokens, customer names/phones/addresses (rule 07): log order ids, codes and counts only.
- KiotViet: `POST /orders` (body fields per spec §7), `GET /orders` (`branchIds`, `lastModifiedFrom`, `pageSize` ≤ 100, `currentItem`), `GET /orders/{id}`. Order status numbers are not documented in the guide: use one constant map `KV_ORDER_STATUS = { draft: 1, delivering: 2, completed: 3, cancelled: 4, confirmed: 5 }` and list it under "Still to verify" in `docs/integrations/kiotviet.md`.

---

### Task 1: Commerce — order push facade and the `external` stock state

**Files:** `apps/backend/src/modules/commerce/domain/order-stock.ts` (+ spec), `domain/order-push.ts` (new, pure: eligibility + KiotViet-neutral push payload), `api/order-push.facade.ts` (new, `ORDER_PUSH_FACADE`), `application/order-push.service.ts` (new), `application/ports/commerce-store.ts` + `infrastructure/persistence/orders.drizzle.ts` (tx methods), `application/order.mappers.ts` (DTO), `commerce.module.ts`, `MODULE.md`; contracts `packages/contracts/src/commerce/commerce.schema.ts` (`OrderDto.external`, `OrderSummaryDto.external`); tests `__tests__/order-push.integration.spec.ts`, `domain/order-push.spec.ts`.

**Interfaces — Produces:**

```ts
// api/order-push.facade.ts
export interface PushableOrder {
  id: string; code: string; placedAt: Date; note: string;          // noteInternal + notePrint joined, ≤ 500 chars
  lines: Array<{ externalVariantId: string; sku: string; name: string; qty: number; unitPrice: number; lineDiscount: number }>;
  discount: number; shippingFee: number; total: number;
  customer: { name: string; phone: string | null };
  recipient: { name: string; phone: string | null; address: string };   // full address text
}
export type PushProblem = { reason: 'unlinked_product'; name: string } | { reason: 'empty' };
export interface OrderPushFacade {
  /** Atomically moves up to `limit` eligible orders from external_state null to 'pending' and returns their ids. */
  claimOrdersForPush(ws: WorkspaceId, source: 'kiotviet', since: Date, limit: number): Promise<string[]>;
  /** The push payload of a pending order, or a problem that makes it unpushable. */
  pushableOrder(ws: WorkspaceId, orderId: string): Promise<{ order: PushableOrder } | { problem: PushProblem } | null>;
  markOrderPushed(ws: WorkspaceId, orderId: string, ref: { externalId: string; externalCode: string; externalStatus: string }): Promise<void>;
  markOrderPushFailed(ws: WorkspaceId, orderId: string, error: { code: string; params?: Record<string, string | number> }): Promise<void>;
  /** "Thử lại": failed → null so the next scan claims it again. 409 when not failed. */
  requeueOrderPush(ws: WorkspaceId, orderId: string): Promise<void>;
  /** order.update from the PMS: stores the status; a cancellation cancels the Rapiz order (history "Đơn đã huỷ trên KiotViet"). */
  applyExternalOrderStatus(ws: WorkspaceId, source: 'kiotviet', externalId: string, status: { code: string; cancelled: boolean }): Promise<'updated' | 'cancelled' | 'unknown'>;
  pushedOrderCount(ws: WorkspaceId, source: 'kiotviet'): Promise<number>;
}
export const ORDER_PUSH_FACADE = Symbol('ORDER_PUSH_FACADE');
```

Rules (spec §7):
- Eligible: `external_state is null`, `deleted_at is null`, status not `cancelled`, `created_at >= since`, and either `created_by_kind = 'agent'` or (`created_by_kind = 'bot'` and `review_state = 'approved'` and `reviewed_at <= now() − 5 s`). Claim with `UPDATE … SET external_state='pending', external_source=… WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING id`.
- `pushableOrder`: every line's variant must have `external_id` (of a product linked to the source) else `{ problem: { reason: 'unlinked_product', name } }` (first offending product name).
- `markOrderPushed` (one tx, order row locked): store refs, `external_state='pushed'`, `external_pushed_at=now`, `external_error=null`; if `stock_state='reserved'` release the hold through the inventory apply path (movement `release`, `ref_type 'order'`), then `stock_state='external'`; history note "Đã đẩy sang KiotViet (<code>)".
- `StockState` gains `'external'`; `stockTransition('external', any)` → `{ next: 'external', actions: [] }`. Item edits stay refused (only `reserved` allows them).
- `applyExternalOrderStatus`: find by `(external_source, external_id)`; store `external_status`; if `cancelled` and the Rapiz order is not cancelled → status `cancelled` with history "Đơn đã huỷ trên KiotViet" (no stock action, state `external`).
- Contracts: `OrderDto.external` and `OrderSummaryDto.external` = `z.object({ state: z.enum(['pending','pushed','failed']), code: z.string().nullable(), status: z.string().nullable(), error: z.object({ code: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])).optional() }).nullable() }).nullable().default(null)`.

- [ ] Tests first (domain eligibility/stock transition units; DB integration: claim picks staff orders and approved-and-settled bot orders only, never twice under concurrency; pushable problem for an unlinked line; mark pushed releases the hold with one movement and sets `external`; later status change moves no stock; KV cancel cancels the Rapiz order; requeue only from failed) → implement → `pnpm --filter @agent-sales/backend test -- commerce`, typecheck, `pnpm arch` → commit `feat(commerce): order push facade and the external stock state`.

### Task 2: Integration — push jobs, KiotViet orders API and order webhooks

**Files:** `integration/application/ports/kiotviet-gateway.ts` + `infrastructure/clients/kiotviet-client.ts` (+ schemas, fake server), `domain/kiotviet-order.ts` (new, pure: `PushableOrder` → KiotViet body; KiotViet status → `{ code, cancelled }`), `application/order-push.ts` (new), `application/sync-runner.ts`, `application/sync.service.ts` (job dispatch by kind), `application/webhook-apply.ts` (`order.update`), `application/connection.service.ts` (webhook set incl. `order.update` when `pushOrders`; ensure on settings save and once per reconcile), `infrastructure/persistence/integration.drizzle-store.ts` (`RUNNABLE_KINDS` + `push_order`), `interface/http/integration.controller.ts` + contracts route `POST /integrations/kiotviet/orders/{orderId}/push` (202, `orders.manage`), `MODULE.md`, `docs/integrations/kiotviet.md`.

**Interfaces — Produces:**

```ts
// gateway additions
createOrder(c: KvCredentials, body: KvOrderBody): Promise<{ id: number; code: string; status: number }>;
recentOrders(c: KvCredentials, q: { branchId: number; since: Date; currentItem: number; pageSize: number }): Promise<KvPage<{ id: number; code: string; status: number; description: string | null }>>;
orderById(c: KvCredentials, id: number): Promise<{ id: number; code: string; status: number } | null>;
// domain/kiotviet-order.ts
export function kiotVietOrderBody(o: PushableOrder, branchId: number): KvOrderBody;  // description starts with "Rapiz <code>"
export function orderStatusOf(status: number): { code: string; cancelled: boolean };
export const RAPIZ_CODE_MARK = (code: string) => `Rapiz ${code}`;
```

Behaviour:
- Runner tick: every 15 s, for each connection with `settings.pushOrders` and status `connected|syncing`, `claimOrdersForPush(ws, 'kiotviet', connection.createdAt, 20)` and enqueue one `push_order` job per id (`payload { orderId, firstAttemptAt }`). Claimed jobs run like other jobs (lease, fencing, liveness, `connect_failed` guard).
- `push_order` job: `pushableOrder` → problem → `markOrderPushFailed({ code: 'unlinked_product', params: { name } })`, complete job. Else if `payload.ambiguous`: first `recentOrders(branch, firstAttemptAt − 1 min)` pages, adopt the order whose description contains `RAPIZ_CODE_MARK(code)` → `markOrderPushed`. Otherwise `createOrder` → `markOrderPushed`. Timeout / 5xx / network error → set `payload.ambiguous = true` (save in cursor) and `retryJob`; after the last retry → `markOrderPushFailed({ code: 'kiotviet_unavailable' })`. Auth errors → connection error path as in PR 1 plus `markOrderPushFailed({ code: 'auth_failed' })`. 4xx validation from KiotViet → `markOrderPushFailed({ code: 'kiotviet_rejected' })` (no retry). Log `order_pushed {code}` (info) and `order_push_failed {code, reason}` (warning) in the sync log; counts.ordersPushed from `pushedOrderCount` after each success.
- Customer: send `customer: { name, contactNumber }` inline and `orderDelivery: { receiver, contactNumber, address, price: shippingFee }` (field names per spec §7; to verify on a trial store). PR 3 replaces inline customer with find-or-create.
- `order.update` webhook: refetch each order id with `orderById` (don't trust `Data`), `applyExternalOrderStatus`; unknown id → ignore.
- Webhooks: when `pushOrders` is on, the set includes `order.update`; settings save and each reconcile ensure the set (list by URL, register missing, delete `order.update` when push is off).
- "Thử lại" route: `requeueOrderPush` (409 when not failed). `orders.manage`.
- Contracts: settings `pushOrders` stays; sync log codes `order_pushed`, `order_push_failed`.

- [ ] Tests first (domain body mapping incl. description mark and discounts; status map; client createOrder/recentOrders against the fake server; job: success, unlinked, ambiguous timeout → adopt existing on retry (no duplicate), 4xx → failed no retry, last retry → failed; runner scan enqueues once; webhook order.update cancels; route 202/409; webhook set ensure) → implement → `pnpm --filter @agent-sales/backend test -- integration http`, DB integration specs, typecheck, `pnpm arch` → commit `feat(integration): push Rapiz orders to KiotViet and read their status back`.

### Task 3: Web, e2e and docs

**Files:** `apps/web/src/features/commerce/components/order-columns.tsx` (+ test) and `order-detail*.tsx` — KiotViet chip: `pending` "Đang đẩy", `pushed` "Đã đẩy · <code>", `failed` "Lỗi" with the error copy in a tooltip/line and a "Thử lại" button (`orders.manage`) calling the new route through a hook that lives in the integration feature and is passed down from the routes (features don't import each other); a note on pushed orders "Đơn đã ở KiotViet — cập nhật trạng thái trên KiotViet"; `features/integration` wizard + settings: enable "Đẩy đơn sang KiotViet" (remove "Sắp có", keep "Đồng bộ khách hàng" as "Sắp có"); i18n (vi/en) for chip, errors (`unlinked_product` "Sản phẩm {{name}} không có trên KiotViet", `kiotviet_rejected` "KiotViet từ chối đơn — kiểm tra lại thông tin đơn", `kiotviet_unavailable`, `auth_failed`) and log codes; e2e `apps/web/e2e/pms-kiotviet-orders.spec.ts` (orders list shows the three chip states; Thử lại calls the route; 375/1280 no overflow); docs: spec §7 (route path change), `docs/integrations/kiotviet.md` (order push flow, statuses to verify), `docs/03`, `docs/05` (stock state `external`), commerce/integration MODULE.md.

- [ ] Tests first → implement → `pnpm check` green, e2e (new + responsive + orders specs) → commit `feat(web): show KiotViet push state on orders and enable order push`.
