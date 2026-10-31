# Bot orders, calculator tool and the orders list review — design

Status: approved in chat by the owner on 2026-10-31. Builds on ADR-015 (agent harness v2) and branch
`feat/agent-harness-v2`. Requires ADR-016 (the ai module writes orders through a commerce facade).

## 1. Goals

1. The bot never does mental arithmetic: every money or quantity figure it states is computed by a
   `calculate` tool with exact decimal arithmetic.
2. The bot can close a sale in chat. It checks stock, gathers the order details, sends the customer
   a summary with two quick-reply buttons, and creates the order only after the customer agrees.
3. Staff can see at a glance which orders the bot created, review them, and jump to the
   conversation that produced each one.
4. The orders list product column shows each order's products in full on hover: picture, full name,
   variant, quantity and price.

Non-goals: payments, shipping-fee calculation by carrier or zone, editing a bot order in chat after it
was created, bulk approve, auto-approve.

## 2. Owner decisions (2026-10-31)

| Topic | Decision |
|---|---|
| Customer confirmation | Required. The bot sends a short order summary "form" and the order is placed only when the customer agrees. |
| Form shape | One summary message plus two quick-reply buttons: `✅ Đặt hàng` and `✏️ Sửa thông tin`. Typing "ok/chốt/đặt" also counts. |
| Stock | A bot order reserves stock at creation, exactly like a staff order. Cancelling it releases the stock. |
| Review | The status flow is unchanged. A bot order carries the review state `pending` → `approved`. Rejecting means cancelling it as usual. |
| Shipping fee | A fixed default from the bot's settings when configured. Otherwise the summary says "Phí ship: shop báo sau", the order has shipping 0 and staff set it on review. |
| Calculator | mathjs in BigNumber mode, restricted. |
| Created-by column | A new default "Người tạo" column replaces the hidden creator column. |
| Test chat | Shows the quick-reply buttons. Clicking one sends it as the customer's message. |

## 3. Calculator tool

- Tool `calculate`, read-only, input `{ expression: string }` (at most 300 characters).
- Evaluated by a dedicated mathjs instance (`create(all, { number: 'BigNumber', precision: 64 })`) in
  `apps/backend/src/modules/ai/application/calculator.ts`.
  - The instance disables `import`, `createUnit`, `evaluate`, `parse`, `simplify`, `derivative`,
    `resolve`, `reviver` and every matrix/unit constructor, via the documented mathjs security pattern.
  - Allowed: numbers, `+ - * / ^ %` (postfix percent), parentheses, `round(x[, n])`, `floor`, `ceil`,
    `abs`, `min`, `max`, `sum`.
  - Vietnamese-formatted input is normalised before parsing: thousands dots and spaces inside numbers
    are removed (`1.760.000` → `1760000`), `,` as a decimal separator becomes `.`, and `x`/`×` become `*`.
  - Errors return `{ error: 'invalid_expression' }`. Exponents are capped (`|exponent| ≤ 15`), and results
    that are not finite or that exceed 1e15 return `{ error: 'out_of_range' }`.
- Result: `{ value: "2250000", formatted: "2.250.000" }`. `formatted` uses the vi-VN grouping, and a
  non-integer value is rounded to at most 2 decimals for display only.
- Prompt rule: every total, discount, deposit or quantity the bot states must come from `calculate`
  (or from an order summary built by the server). The bot never computes in its head.
- New dependency: `mathjs` in `apps/backend`. It is backend-only, so its size does not matter.

## 4. Bot order flow

### 4.1 Tools (offered only when the bot's "chốt đơn" capability is on; see §4.6)

1. **`prepare_order`** is a write tool. Input:
   ```
   { items: [{ sku: string, qty: int 1..99 }] (1..20),
     recipient: { name: string ≤ 120, phone: string, address: string ≤ 300 },
     note?: string ≤ 300 }
   ```
   The server, through `CommerceFacade.prepareBotOrder`:
   - resolves each SKU to a variant of an active product in the bot's catalog scope (only products the
     bot can sell);
   - checks `available = on_hand − reserved ≥ qty`;
   - normalises the phone with the existing Vietnamese phone detector;
   - computes the amounts with the same `computeAmounts` used by staff orders. Unit prices come from the
     catalog; the model cannot set a price.
   - On problems it returns `{ ok:false, problems:[{ code, sku?, available? }] }` and stores nothing.
     The codes are `unknown_sku`, `inactive`, `insufficient_stock`, `missing_name`, `missing_phone`,
     `invalid_phone` and `missing_address`.
   - Otherwise it stores the draft (§4.3), and the **server** delivers the summary message with the two
     quick replies through the turn's sink (§4.4). The tool then returns
     `{ ok:true, status:'awaiting_customer_confirmation', summaryText }`.
   - A new `prepare_order` replaces the conversation's earlier draft.
2. **`confirm_order`** takes no input. It is offered only while a draft exists that was stored in an
   *earlier* turn, which is the same rule as `confirm_pending_action`.
   - It atomically takes the stored draft (never the model's arguments) and calls
     `CommerceFacade.confirmBotOrder`, which checks stock again and creates the order in one
     transaction.
   - It returns `{ ok:true, orderCode }` or `{ ok:false, code }`, where `code` is `expired`,
     `insufficient_stock` or `nothing_pending`.
   - A transient failure stores the draft again.
3. **`cancel_order_draft`** takes no input and is offered while a draft exists. It is used when the
   customer wants to change something, followed by a new `prepare_order`.

### 4.2 Prompt guidance (sales-agent@15 / @16, from @13 / @14)

- Close the sale only when the customer clearly wants to buy.
- Gather products and quantities, the recipient name, phone and address. Ask for what is missing,
  one question at a time.
- Check stock with `search_products`/`product_details` first, then call `prepare_order`.
- Never restate the summary yourself: the server sends it.
- On "✅ Đặt hàng", "ok", "chốt" or "đặt" after a summary, call `confirm_order` and tell the customer
  the order code. On "✏️ Sửa thông tin", ask what to change.
- Do not call `handoff` merely because an order is ready. Handoff stays for a human request or a staff
  decision. The handoff tool description drops "an order is ready".
- Use `calculate` for any figure that is not part of the server's summary.

### 4.3 Draft storage (commerce module)

- New table `bot_order_drafts` with columns `workspace_id`, `conversation_id` (unique per workspace),
  `bot_id`, `lines` (jsonb `[{variantId, sku, qty}]`), `recipient` (jsonb), `note`, `shipping_vnd`,
  `amounts_hash`, `created_at` and `expires_at` (30 min). It has forced RLS.
- `confirmBotOrder` deletes the row in the same transaction that creates the order. Expired rows are
  ignored and swept opportunistically.

### 4.4 The summary message and quick replies

- The summary text is built by code in `commerce/domain/order-summary.ts`. It is Vietnamese, fixed,
  and uses vi-VN money formatting:
  ```
  Dạ em tóm tắt đơn của mình ạ:
  • Thú gỗ xếp thăng bằng ×2 — 1.760.000đ
  • Tháp cầu vồng ×1 — 460.000đ
  Phí ship: 30.000đ            (or: Phí ship: shop báo sau)
  Tổng: 2.250.000đ
  Người nhận: Lan · 0912 345 678
  Địa chỉ: 12 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội
  Ghi chú: …                   (when present)
  ```
  It is at most 2 000 characters, with long product lists truncated with "… và N sản phẩm khác".
  It never addresses the customer with a guessed pronoun.
- `OutgoingMessage` gains `quickReplies?: { title: string; payload: string }[]`, at most 3 titles of
  20 characters or fewer. The two replies are `✅ Đặt hàng` (`ORDER_CONFIRM`) and
  `✏️ Sửa thông tin` (`ORDER_EDIT`).
- Meta adapter (Messenger and Instagram):
  - Outbound: send `quick_replies` with `content_type:'text'` on the text message, and set
    `capabilities.quickReplies = true`.
  - Inbound: read `message.quick_reply.payload`. The customer message text stays the button title, and
    the payload is kept on the event for logs and tests. The bot sees the title text.
- The conversation processor delivers the summary as text bubbles. Quick replies attach to the **last**
  bubble only. It uses the same pacing and idempotency keys as other sends.
- Webchat (website adapter) already declares quick-reply support and renders them the same way.

### 4.5 Creating the order (`CommerceFacade.confirmBotOrder`)

- The new order has:
  - `source` = the conversation channel (`facebook`/`instagram`/`website`);
  - `status` = `new`;
  - `created_by_kind = 'bot'` and `created_by_name` = the bot's name;
  - `created_by_user_id` = null;
  - `conversation_id`;
  - `review_state = 'pending'`;
  - customer and recipient set from the draft;
  - lines snapshotted as for staff orders;
  - `shipping_vnd` from the draft.
- Stock is reserved through the existing `stockTransition('released', 'new')`.
- Idempotency: `client_request_id = bot:<conversationId>:<amounts_hash>`. A repeated confirmation
  returns the existing order.
- The status history records "Bot tạo đơn từ hội thoại".
- The CRM lead is upserted with name, phone and address through the existing `upsertLeadByPhone`.
- Staff orders now write `created_by_kind = 'agent'`. Existing rows keep the column default.

### 4.6 Capability switch and shipping default

- Bot settings gain a "Chốt đơn" section:
  - `orderTaking: boolean`, default **off** for existing bots and on for new retail bots;
  - `orderShippingFeeVnd: Money | null`, where null means "shop báo sau".
- When `orderTaking` is off, the bot has no order tools and the prompt keeps today's behaviour
  ("ready orders → handoff").
- The lodging prompt (@16) gets the order tools only when `orderTaking` is on. Lodging bookings stay
  handled by actions/handoff.

## 5. Data model (migration `0039_bot_orders.sql`, additive)

- On `orders`:
  - `conversation_id uuid null`, indexed on `(workspace_id, conversation_id)`. There is no
    cross-module foreign key; it is validated by the facade.
  - `review_state text null check (review_state in ('pending','approved'))`;
  - `reviewed_by_user_id uuid null` and `reviewed_at timestamptz null`;
  - partial index `(workspace_id, created_at desc) where review_state = 'pending'`.
- Table `bot_order_drafts` as described in §4.3.
- Bot settings: the two new fields, stored where the bot settings live.
- Contracts:
  - `OrderSummaryDto` gains `createdByKind`, `reviewState`, `reviewedByName`, `reviewedAt` and
    `conversationId`;
  - `itemsPreview` items gain `variantName`, `unitPrice` and `imageUrl` (nullable);
  - `OrderListQuery` gains `review=pending`;
  - `OrderDto` gains the same review and conversation fields;
  - new route `POST /orders/{id}/approve`.

## 6. Orders list and order detail (web)

Applies the Rapiz design rules: brand orange accents on white/black, Lucide icons only (no emoji
icons), and tokens from the existing shadcn theme.

### 6.1 "Người tạo" column (default visible; replaces the hidden "createdBy" column)

| Order | Cell content |
|---|---|
| Staff | The staff name in normal text. It counts as reviewed. |
| Bot, pending | Badge `Bot` with Lucide `Bot` icon, then a status chip `Chờ duyệt` (amber tone, dot and text, never colour alone), then an icon button **Mở hội thoại**. |
| Bot, approved | Badge `Bot`, then a muted chip `Đã duyệt` with `Check` icon (its tooltip says "Duyệt bởi {name} · {time}"), then the **Mở hội thoại** button. |

- **Mở hội thoại** is an icon button (`MessagesSquare` + `ArrowUpRight`) with
  `aria-label="Mở cuộc trò chuyện ở tab mới"` and a tooltip of the same text.
  - It is an `<a href="/app/inbox?conversation={id}" target="_blank" rel="noopener">`.
  - Its hit area is at least 32×32 px, inside a padded cell.
  - `stopPropagation` keeps the row click from also firing.
  - It is hidden when the order has no `conversationId`.
- Column width is about 220 px. It is sortable by `created_by_kind` then `review_state` (pending first).

### 6.2 Toolbar quick filter

- A toggle chip **"Bot · chờ duyệt (n)"** next to the existing filters.
  - `n` comes from a count query and is hidden when 0.
  - Active state: brand-orange outline and `aria-pressed`.
  - It maps to the URL search `review=pending`, so it can be deep-linked and survives navigation back.

### 6.3 Approving

- The row menu (⋯) gains **Duyệt đơn** for pending bot orders. It gives optimistic UI and a toast
  "Đã duyệt đơn {code}" with an undo action for 5 s. Undo calls the same endpoint with
  `approve:false` and is allowed only within 5 s and only by the same user.
- The order detail page shows a banner at the top for bot orders:
  - Pending: amber surface with text "Đơn do bot tạo từ hội thoại — cần kiểm tra trước khi xử lý".
    The buttons are **Duyệt đơn** (primary) and **Mở hội thoại** (secondary, new tab).
  - Approved: a compact muted line "Bot tạo · duyệt bởi {name} lúc {time}" plus the conversation
    link.
- Approving is idempotent. It records `order_status_history` with "Đã duyệt đơn do bot tạo".
  Cancelling uses the existing cancel flow.

### 6.4 Product column hover card

- The cell is unchanged: one line per preview item (`qty× name`), truncated with `…`.
- On hover (open delay 300 ms, close delay 100 ms) **or keyboard focus** of the cell trigger, a light
  floating card opens (a new `hover-card.tsx` built on Radix HoverCard, same tokens as `popover`). It
  is about 320 px wide and at most 360 px tall, scrolling inside.
  - Header: "{n} sản phẩm".
  - One row per order line:
    - a 40×40 thumbnail (`object-cover`, rounded, `loading="lazy"`, fixed size so nothing shifts),
      falling back to Lucide `Package` on a muted square;
    - the **full product name**, wrapping up to 2 lines;
    - the variant name in muted text;
    - right-aligned `qty × unit price` with tabular figures.
  - Footer: the order total.
- Accessibility:
  - The trigger is a focusable element with `aria-describedby` pointing to the card.
  - `Escape` closes the card.
  - The card's content is also reachable on the detail page, so hover is not the only way to see it.
- `prefers-reduced-motion` disables the fade/scale.

### 6.5 i18n

All new strings go in `packages/i18n/src/messages/{vi,en}/common.json` under `orders.*`
(`orders.col.createdBy`, `orders.review.*`, `orders.items.*`) and `bot.settings.orders.*`.

### 6.6 Test chat

- The test chat renders a message's `quickReplies` as pill buttons under its last bubble, only on the
  newest bot message.
- Clicking a button sends its title as the customer's next message and removes the buttons.
- `PlaygroundResponse.messages[]` items gain `quickReplies?`.

## 7. Module boundaries and ADR-016

- The ai module calls `CommerceFacade.prepareBotOrder / confirmBotOrder / cancelBotOrderDraft`
  through `commerce/api`. These are new public methods and must be listed in `commerce/MODULE.md`.
- The conversation module passes `conversationId` and channel kind, which already arrive in
  `ReplyOptions`.
- ADR-016 records:
  - the ai → commerce write path;
  - "bot creates, customer confirms, staff reviews";
  - stock reservation by bot orders;
  - the quick-reply channel capability.

## 8. Testing

- **Calculator unit tests:**
  - Vietnamese number formats, percent, rounding, BigNumber exactness (`0.1+0.2`, large VND sums);
  - rejected inputs: `import(...)`, `createUnit`, function definitions, matrices, units, overly long
    or deep expressions, huge exponents.
- **Commerce facade:**
  - prepare with each problem code;
  - prepare replaces an earlier draft;
  - confirm creates the order with `created_by_kind = bot`, `review_state = pending`, the conversation
    link, reserved stock and history;
  - confirm is idempotent and expires after 30 min;
  - confirm rechecks stock;
  - integration test with forced RLS for `bot_order_drafts` (cross-tenant read and write denied);
  - approve endpoint: auth, workspace membership, idempotency, and rejected for non-bot orders.
- **AI tools:**
  - order tools are offered only when `orderTaking` is on;
  - `confirm_order` is not offered in the same turn as `prepare_order`;
  - the summary is sent by the server with quick replies through the sink;
  - the model's arguments are ignored on confirm.
- **Channels:**
  - Meta outbound `quick_replies` payload shape;
  - inbound `quick_reply.payload` is parsed;
  - quick replies attach to the last bubble only.
- **Web:**
  - the "Người tạo" column in all three states;
  - the conversation link has the new-tab attributes and does not trigger the row click;
  - the quick filter writes the URL search;
  - approve with optimistic update and undo;
  - the hover card opens on hover and on focus, shows the full names, the image fallback and the total;
  - the test chat quick replies send and disappear.
- **Evals:**
  - totals are computed with `calculate` (the case asserts a `calculate` step and the exact figure);
  - when details are missing, the bot asks for phone and address before preparing;
  - a complete request leads to `prepare_order` and a summary with quick replies;
  - the customer replying "✅ Đặt hàng" leads to `confirm_order` and the order code in the reply;
  - insufficient stock makes the bot offer the available quantity.

## 9. Out of scope

Shipping fees by zone or carrier, payment links, a deposit flow, staff editing a draft before the
customer confirms, multiple concurrent drafts per conversation, auto-approve, bulk approve, and
notifications for new bot orders. Notifications are noted as a follow-up.
