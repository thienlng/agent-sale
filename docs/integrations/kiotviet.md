# KiotViet integration ("Tích hợp PMS")

A shop that sells with KiotViet links its store to Rapiz. The bot then quotes KiotViet's names, prices,
pictures and stock, and staff stop keeping two catalogs. For linked products KiotViet is the source of truth
([ADR-017](../adr/ADR-017-external-source-of-truth-pms.md)). Design: `docs/superpowers/specs/2026-11-01-pms-kiotviet-design.md`.
Code: backend module `apps/backend/src/modules/integration` (see its `MODULE.md`), webhook ingress
`apps/webhook/src/kiotviet.ts`, web feature `apps/web/src/features/integration`.

| Shipped | Next |
|---|---|
| Products, variants (units and attributes), categories, pictures, stock of the chosen sale branches (PR 1); bot and staff orders pushed to KiotViet with their status read back (PR 2) | Customer sync (PR 3) |

The wizard asks for the order branch and shows "Đẩy đơn sang KiotViet" as a switch (on by default; the
connection page's "Cài đặt đồng bộ" turns it off or on again, saved with the other settings through
`PATCH /integrations/kiotviet`). "Đồng bộ khách hàng" is still "Sắp có": shown on and locked, so PR 3 starts
working without the owner saving again.

## Owner setup

Sidebar **Tích hợp PMS** (`/app/integrations`) → KiotViet → **Kết nối** (`/app/integrations/kiotviet`).
Connecting needs the `settings.manage` capability (owner, admin); members with `catalog.manage` see the
connection read-only.

Get the API credentials in KiotViet (the same four steps the wizard shows under "Lấy mã ở đâu?"):

1. Sign in to KiotViet with the store owner's account.
2. Open **Thiết lập → Cửa hàng → Kết nối API** and click **Chỉnh sửa**.
3. Verify with the phone number, click **Tạo mã** and tick access to customers, invoices and orders.
4. Copy the **Client ID** and the **Mã bảo mật** (client secret) into Rapiz.

Then the wizard:

1. **Thông tin kết nối** — store name (the part before `.kiotviet.vn`; pasting the store URL works), Client
   ID, secret → **Kiểm tra kết nối**. Rapiz gets a token, reads the branches and previews the first sync.
   Nothing is stored yet.
2. **Chi nhánh** — tick the branches that sell online (their stock is summed for the bot) and pick the
   branch that will receive orders.
3. **Xem trước & bắt đầu** — "N sản phẩm khớp theo mã · M sản phẩm mới · K sản phẩm chỉ có trên Rapiz".
   The preview reads at most 3 000 product codes; for a larger store it says "trong 3 000/N sản phẩm đầu" and
   leaves out the Rapiz-only count. **Bắt đầu đồng bộ** connects and starts the full import.

The page then shows the connection: status, import progress (refreshed every 3 s; the owner may leave),
counts, sync settings (branches), **Đồng bộ ngay**, **Cập nhật mã** (a new secret for the same store),
recent activity and **Ngắt kết nối**.

## Data flow

```
KiotViet ──webhook──▶ apps/webhook  POST /webhooks/kiotviet/:token ──▶ integration_webhook_events (raw)
    ▲                                                                        │
    │ REST (token, 4 500 req/h budget)                                       ▼
    └──────────────── worker: integration tick every 2 s ◀── integration_jobs (full_import, reconcile, push_order)
                              │
                              ▼ CATALOG_SYNC_FACADE (commerce)
                       products, product_variants, inventory (+ movements), pictures
```

- **Full import** (on connect, after a sale-branch change, and when "Đồng bộ ngay" finds no earlier
  reconcile): reads every product page (100 per page, in a stable `orderBy=id` ascending order), then the
  on-hand stock of the sale branches. The cursor is saved after each page, so a restarted worker resumes.
  Matching the first time: a KiotViet code equal to a Rapiz variant SKU (case-insensitive) links that Rapiz
  product (its bot settings stay); otherwise a new product is created. After a complete import (no short
  page, and the product total unchanged from the first page to the last), linked products and variants the
  import did not see are archived, never deleted, once KiotViet confirms each is gone (`GET /products/{id}`
  → not found); at most 200 per run, the rest are checked on the next full import (`sweep_capped`).
- **Webhooks** (`product.update`, `product.delete`, `stock.update`, registered on connect when
  `PUBLIC_WEBHOOK_BASE_URL` is set): the ingress stores the raw body; the worker checks the HMAC-SHA256
  signature (`X-Hub-Signature`), re-reads the products by id from KiotViet (the payload is never trusted)
  and applies them. A price changed in KiotViet reaches the bot within seconds.
- **Reconcile** every 10 minutes per connection: reads products changed since the last run (2-minute overlap)
  and archives the ones KiotViet reports as removed. It also catches lost webhooks.
- **Stock** = Σ max(0, on hand − reserved) over the sale branches (a missing branch counts 0), written to the
  default Rapiz warehouse as an `adjust` movement with `ref_type = 'external'`.
- **Order push** (PR 2, `settings.pushOrders`, `application/order-push.ts`): every 15 s the worker claims
  orders created since the connection — staff orders at once, bot orders 5 s after their approval — and
  queues one `push_order` job each. The job sends `POST /orders` to the order branch: lines by KiotViet
  product id and code, the order discount, `customer` (name, phone) and `orderDelivery` (receiver, phone,
  address, price), and a description starting `Rapiz <order code>`. Rapiz's surcharge has no free field in
  KiotViet (`surchages` needs a surcharge set up in the store), so it is added to the delivery price: the
  KiotViet total always equals the Rapiz total. Before the call the job marks itself ambiguous; any retry
  (lost answer, timeout, 5xx, crash) first lists the branch's orders modified since a minute before the
  first attempt and adopts the one carrying the code, so a retry never creates a second KiotViet order.
  Retries: +1, +5, +30 min, then the order shows "Lỗi" with **Thử lại**
  (`POST /integrations/kiotviet/orders/{orderId}/push`, `orders.manage`). An order with a product not
  linked to KiotViet, or one KiotViet refuses (4xx), fails at once. Once pushed, KiotViet owns the order's
  stock (`stock_state = 'external'`, the Rapiz hold is released) and the job re-reads the lines' KiotViet
  products (`GET /products/{id}`) and sets their Rapiz stock to KiotViet's available over the sale
  branches, which now counts the order as `reserved`: the units are never sellable twice in between (best
  effort; a failure only logs, the next reconcile repairs it).
- **Order status**: the `order.update` webhook (registered while push is on; each settings save and each
  reconcile add or remove it) re-reads the order from KiotViet and stores its status; a KiotViet
  cancellation cancels the Rapiz order. Each reconcile also re-reads the order branch's orders changed since
  the previous one, so a lost delivery is repaired within 10 minutes. **Thử lại** after an attempt whose
  answer was lost looks for the KiotViet order first, too. A pending order whose job was lost is queued again
  after 2 minutes; disconnecting, or turning push off, returns orders still waiting to "not pushed" (while
  push is off the worker also returns any claim older than 2 minutes).

## Order push on the orders pages

Each order carries `external` (`OrderSummaryDto` / `OrderDto`): `null` when it was never pushed, else
`{ state, code, status, error }`.

| `state` | Orders list ("KiotViet" column; chip on the mobile card) | Order page ("KiotViet" card) |
|---|---|---|
| `pending` | "Đang đẩy" | "Đang đẩy" and a note that products and amounts are locked for a few seconds |
| `pushed` | "Đã đẩy · <KiotViet code>" | the chip, "Trạng thái trên KiotViet: …" (from `status`) and "Đơn đã ở KiotViet — cập nhật trạng thái trên KiotViet" |
| `failed` | "Lỗi" (the reason on hover/focus) and **Thử lại** | "Lỗi", the reason and **Thử lại** |

- The "KiotViet" column is always on (not in the column picker) but left out when no order on the page has
  been pushed, so a workspace without KiotViet never sees it. The CSV export carries the chip text; it has
  the column when any exported order was pushed (whatever page is on screen).
- **Thử lại** shows only with `orders.manage`. It calls `POST /integrations/kiotviet/orders/{orderId}/push`
  (202; 409 `PUSH_NOT_FAILED` when the push is no longer failed, which the page explains and reloads; 409
  `not_pushing` when no connection pushes orders — none, push off, not connected — or the order was created
  before the current connection: "KiotViet chưa bật đẩy đơn hoặc đơn được tạo trước khi kết nối"). After a
  202 the orders are read again after 3 s and 15 s, so the list shows the new state without a reload. The hook lives in
  `apps/web/src/features/integration/api/integrations.ts` (`useRetryOrderPush`); the orders routes pass it
  to the commerce components, since web features do not import each other.
- While a push is pending, the list and the order page re-read every 3 s until it is pushed or failed.
  An edit that touches what the push sends (lines, discount, shipping fees, surcharge; the shipping panel
  sends its carrier fee only when changed, so notes and payment stay editable) answers 409
  `details.reason = 'PUSH_PENDING'` meanwhile; the editors say "Đơn đang được đẩy sang KiotViet, chờ vài giây rồi sửa lại."
- `error.code` → copy (`common.json` → `orders.push.errors.*`): `unlinked_product` ("Sản phẩm {{name}}
  không có trên KiotViet"), `empty_order`, `kiotviet_rejected` ("KiotViet từ chối đơn — kiểm tra lại thông
  tin đơn"), `kiotviet_unavailable`, `kiotviet_link_conflict`, `auth_failed`, `not_connected`,
  `sync_failed`; an unknown code falls back to "Chưa đẩy được đơn sang KiotViet".
- `status` names (`orders.push.status.*`): `draft` "Phiếu tạm", `confirmed` "Đã xác nhận", `delivering`
  "Đang giao hàng", `completed` "Hoàn thành", `cancelled` "Đã huỷ"; an unknown value is shown as is.

## What is locked on a linked product

A product with the "KiotViet" badge is edited in KiotViet. In Rapiz, the name, code, description, category,
pictures, status (archive), variants (SKU, name, price, cost, weight; adding or removing) and stock are
read-only, with a "Sửa trên KiotViet" link to `https://<store>.kiotviet.vn`. The API refuses such changes
(all of them except the code, which only the form locks) with 409 `CONFLICT`, `details.reason = 'EXTERNAL_SOURCE'`. Still edited in Rapiz: **visible to the bot**, **bot
instructions** and the bots' product selection (`PATCH /products/{id}/bot-settings`). Products that exist only
in Rapiz stay fully editable.

**Disconnecting** deletes the webhooks at KiotViet (best effort), marks the connection disconnected, then
keeps every synced product, picture and stock figure and removes the links: the products become ordinary
Rapiz products, editable again. A sync or webhook running at that moment stops at its next product; if it
still wrote one after the links were removed, it removes the links again when it sees the disconnect.

## Limits

- KiotViet allows 5 000 requests per hour per store; Rapiz keeps a 4 500/hour budget (bursts of 10). A first
  import of a 5 000-product store takes about 55 calls.
- Pictures: JPEG and PNG only (KiotViet WebP pictures are skipped), at most 5 per product, 10 MiB each. Each
  picture URL is downloaded once (`integration_image_cache`).
- One KiotViet store per business. Changing store means disconnect, then connect again.
- Multiple units become variants ("Hộp", "Thùng"); the unit joins the variant name only when a product has
  several units.

## Troubleshooting (sync log codes)

The activity list on the connection page shows these codes (i18n `integration.json` → `log.*`):

| Code | Meaning | What to do |
|---|---|---|
| `connected` | Store connected. | — |
| `full_sync_done` | A full import finished (`products`, `images_failed`). | — |
| `image_failed` | Some pictures could not be downloaded (usually WebP or a dead link). | Upload JPEG/PNG pictures in KiotViet. |
| `sku_conflict` | A KiotViet code is the SKU of another (unlinked) Rapiz product, or a race repeated. The item was skipped. | Change the code on one side; the next reconcile links it. |
| `auth_failed` | KiotViet rejected the credentials (secret rotated, API access revoked) or the stored secret cannot be decrypted (`SECRETS_ENCRYPTION_KEY` changed). Status `error`, sync stops. | **Cập nhật mã** with a fresh Client ID / secret of the same store. |
| `kiotviet_unavailable` | KiotViet did not answer after retries (+1, +5, +30 min). | Nothing; the job retries. If it lasts, check KiotViet status. |
| `sync_failed` | Another error after the retries. | Click **Đồng bộ ngay**; check the worker logs (codes only). |
| `sweep_capped` | A full import found more than 200 linked products it did not see; 200 were checked with KiotViet, `count` wait for the next full import. | Nothing, unless it repeats (then check the worker logs). |
| `connect_failed` | The connect step failed after the connection row was created. Such a connection never syncs: **Đồng bộ ngay** answers 409 `connect_failed`. | Disconnect (the error card has the button), then connect again. |
| `webhook_register_failed` | Webhooks could not be registered (or `PUBLIC_WEBHOOK_BASE_URL` is unset). | Data still refreshes every 10 minutes; set the base URL and reconnect for instant updates. |
| `webhook_bad_signature` | A delivery failed the HMAC check and was dropped. Logged once per connection per worker process; the worker log keeps the count. | Check the worker log count; if it keeps rising, check the base URL and reconnect. |
| `webhook_unknown` | A webhook type Rapiz does not handle. | Nothing. |
| `order_pushed` | An order (`code`) is now in KiotViet. | — |
| `order_push_failed` | An order (`code`) was not pushed (`reason`: `unlinked_product`, `empty`, `kiotviet_rejected`, `kiotviet_unavailable` after the retries, `auth_failed`, `sync_failed`, `link_conflict`, `not_connected`: the connection was gone when the job ran). | Fix the cause (link the product, check the order) and click **Thử lại** on the order. |
| `order_push_duplicate` | The order (`code`) was already pushed, so KiotViet now holds an extra order for it. | Cancel the extra order in KiotViet; no **Thử lại**. |
| `order_pushed_cancelled` | The order was cancelled (or deleted) in Rapiz while it was being pushed; KiotViet has it. | Cancel the order in KiotViet. |

Wizard errors: wrong Client ID / secret (`kiotviet_auth`), unknown store name (`kiotviet_retailer`), missing
API permissions (`kiotviet_permission`, lists them), a branch no longer in KiotViet (`kiotviet_branch`), new
credentials of another store (`kiotviet_retailer_changed`), KiotViet down or the hourly budget spent (503).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `KIOTVIET_TOKEN_URL` | `https://id.kiotviet.vn/connect/token` | Token endpoint (override only for tests). |
| `KIOTVIET_API_URL` | `https://public.kiotapi.com` | Public API base (override only for tests). |
| `PUBLIC_WEBHOOK_BASE_URL` | unset | Public HTTPS origin of `apps/webhook`; webhooks go to `<base>/webhooks/kiotviet/<token>`. Unset → no webhooks, reconcile only. |
| `SECRETS_ENCRYPTION_KEY` | — (required in production) | Seals the client secret and the webhook secret. |

The worker process must run (it executes the integration tick); see `docs/10-operations-and-deployment.md`.

## Still to verify on a KiotViet trial store

PR 1 was built against the public docs and a fake. Before relying on it in production, check on a trial
store: the `branchIds` query format for on-hands, the status code for an unknown store name, whether the
webhook HMAC key is the registered base64 secret text or its decoded bytes (`webhookSigningKey`, one line),
the field names in webhook `Notifications[].Data` (`ID_KEYS` in `webhook-apply.ts`), that `/products`
accepts `orderBy=id&orderDirection=Asc` (`PRODUCT_ORDER` in `kiotviet-client.ts`, one constant), whether
`GET /webhooks` is paginated, and for the order push (PR 2; the constants live in `domain/kiotviet-order.ts`): the order
status numbers (`KV_ORDER_STATUS = { draft: 1, delivering: 2, completed: 3, cancelled: 4, confirmed: 5 }`,
not in the guide), the `customer` and `orderDelivery` field names (`KV_ORDER_CUSTOMER_FIELD`,
`KV_ORDER_DELIVERY_FIELD`), whether `orderDelivery.price` adds to the order total (the surcharge is folded
into it), whether `orderDetails[].discount` is per unit, the `GET /orders` filters (`branchIds`,
`lastModifiedFrom`) and the `order.update` delivery's id field (`ID_KEYS` in `webhook-apply.ts`), and
whether creating an order emits `stock.update` (its `reserved` changes; the push re-reads the lines'
products right after `POST /orders` either way, so this only tells whether that read is redundant).
