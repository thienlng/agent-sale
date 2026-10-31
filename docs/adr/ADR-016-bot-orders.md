# ADR-016: Bot orders — the bot creates, the customer confirms, staff review

- Status: Proposed (decisions taken by the owner on 2026-10-31; accepted when the bot orders PR merges)
- Date: 2026-10-31
- Decision makers: thienlng (owner)
- Builds on: [ADR-014](ADR-014-tool-calling-for-the-reply-agent.md) and [ADR-015](ADR-015-agent-harness-v2.md) (tool-calling reply agent)

## Context

Until now the bot could only hand a ready order to staff (`handoff`). Staff then retyped products, quantities and the delivery details into the order form, and the customer waited. The owner wants the bot to close a sale in chat: check stock, gather the details, show the customer a summary, and place the order when the customer agrees. Staff must still see which orders the bot created and review them before handling them. Design: `docs/superpowers/specs/2026-10-31-bot-orders-and-calculator-design.md` (§4, §5, §6.3, §7).

Constraints: the model must never set a price or a total. A bot order must hold stock exactly like a staff order. Orders belong to the `commerce` module, and the reply agent lives in `ai`. Modules talk only through `api/` facades (docs/ARCHITECTURE.md §2). Every tenant table has forced RLS (ADR-004).

## Decision

1. **ai → commerce write path.** The `ai` module calls four new `CommerceFacade` methods: `prepareBotOrder`, `confirmBotOrder`, `cancelBotOrderDraft` and `hasBotOrderDraft`. Commerce owns every rule. It resolves SKUs to variants the bot may sell, using the bot's catalog scope (`catalogMode`, `bot_products`) read through the `bot` facade. It checks stock at the default warehouse and normalises the phone (`normalizeVnPhone` from `packages/shared`). It takes prices from the catalog and computes amounts with the shared `computeAmounts`.
2. **Bot creates, customer confirms, staff reviews.**
   - `prepareBotOrder` stores one draft per conversation in the commerce-owned table `bot_order_drafts`. The draft expires after 30 minutes and holds lines, the recipient, the note, the shipping fee, the conversation channel and an `amounts_hash`. A new prepare replaces the earlier draft.
   - The server builds the Vietnamese summary in code (`commerce/domain/order-summary.ts`). The model never restates it.
   - `confirmBotOrder` locks the draft and re-checks prices (via the hash) and stock (locked inventory rows). It then creates the order and deletes the draft in one transaction. The order has status `new`, `created_by_kind = 'bot'`, `review_state = 'pending'`, its `conversation_id`, history "Bot tạo đơn từ hội thoại" and the idempotency key `bot:<conversationId>:<amounts_hash>`.
   - Staff approve the order with `POST /orders/{id}/approve`, which records the reviewer and the history "Đã duyệt đơn do bot tạo". The reviewer may take an approval back within 5 seconds. Rejecting means cancelling the order through the normal flow. Staff orders are never reviewed: they carry `created_by_kind = 'agent'` and a null review state.
3. **Stock reservation by bot orders.** A bot order reserves its goods at creation through the same `stockTransition('released', 'new')` and inventory movements as a staff order, and cancelling it releases them. Unlike staff orders, which may oversell on purpose, a bot order is refused (`insufficient_stock`) when `on_hand − reserved` at the default warehouse is below the quantity, both at prepare and at confirm.
4. **Quick replies as a channel capability.** The summary goes out with two quick replies, `✅ Đặt hàng` (`ORDER_CONFIRM`) and `✏️ Sửa thông tin` (`ORDER_EDIT`). `OutgoingMessage.quickReplies` and the channel adapter capability `quickReplies` carry them. A channel without the capability sends only the text, and the customer types instead.

## Options considered

- **The ai module writes orders itself (its own table or a call into `OrderService`).** Rejected: it would duplicate stock and amount rules outside commerce and break the facade-only boundary.
- **A pending action through the `action` module (`confirm_pending_action`) instead of a commerce draft.** Rejected: an action stores free-form arguments the model wrote. An order needs catalog prices, stock checks and the reservation in the same transaction as the order row, so the draft belongs to commerce.
- **Create the order at prepare time with a "draft" status.** Rejected: it would reserve stock for orders the customer never confirms, and add a status to every list and statistic.
- **Pass `catalogMode` from the ai module in the facade input.** Rejected: commerce would trust the caller for the sales scope. Commerce asks the `bot` facade instead, which adds the module edge commerce → bot (no cycle: `bot` does not depend on `commerce`).
- **Auto-approve bot orders or skip customer confirmation.** Rejected by the owner (spec §2).

## Consequences

- Positive: the bot can close a sale without staff retyping it, with prices and stock enforced by commerce. Staff see bot orders at a glance (`review=pending` filter, `GET /orders/review-count`, the "Người tạo" column) and jump to the conversation.
- New module edges: commerce → bot (catalog scope, through `BOT_FACADE`) and commerce → crm (the customer is upserted by phone after a confirmed order, best effort; the CRM lead takes the name and phone but no address).
- Schema (migration 0039): `orders.conversation_id`, `review_state`, `reviewed_by_user_id`, `reviewed_by_name`, `reviewed_at`; `orders.client_request_id` becomes `text` so it can hold the bot key; the new table `bot_order_drafts` with forced RLS.
- A price change between the summary and the confirmation answers `expired`, and the bot prepares a new summary. A product archived in between answers `insufficient_stock`.
- Follow-ups: notifications for new bot orders; drafts are swept only opportunistically (on prepare in the same workspace), not by a job.
