# ADR-019: Bot lodging holds — the bot checks the calendar, the customer confirms a hold, staff review

- Status: Proposed (decisions taken by the owner on 2026-11-01; accepted when the bot holds PR merges)
- Date: 2026-11-01
- Decision makers: thienlng (owner)
- Builds on: [ADR-018](ADR-018-lodging-module.md) (lodging module), [ADR-016](ADR-016-bot-orders.md) (bot orders), [ADR-015](ADR-015-agent-harness-v2.md) (tool-calling agent)
- Spec: [bot lodging holds](../superpowers/specs/2026-11-01-bot-lodging-holds-design.md) (T-161)

## Context

After lodging parts 1 and 2 (ADR-018), Rapiz holds the real calendar of a hotel business, but the bot cannot read it. Prompt `sales-agent@17` could quote a nightly price and let `calculate` add up a stay, and it had to say it did not know whether the nights were free. Customers ask "ngày X–Y, N người, còn căn nào, bao nhiêu?" all day. Staff then searched the calendar, quoted the total, and typed a hold by hand.

The owner wants the bot to answer from the calendar: say which places are free, quote the exact total, offer other places when the asked one is full, and keep the nights for the customer while staff call to confirm. Constraints:

- The model never sets a price, a total, a weekday or availability. Every number and weekday label it states comes from a tool result.
- No cost price, internal property note, night note or booking tag reaches the bot.
- Bookings belong to the `lodging` module and the reply agent lives in `ai`. Modules talk only through `api/` facades, `lodging` never imports `ai` (docs/ARCHITECTURE.md §2), and every tenant table has forced RLS (ADR-004).
- The bot must never confirm a stay. A hold that nobody follows up must not block the calendar for long.

## Decision

1. **ai → lodging write path through a bot facade.** `lodging/api` exports `LODGING_BOT_FACADE` (`LodgingBotFacade`, provider `LodgingBotHolds`) with `checkAvailabilityForBot`, `prepareBotHold`, `confirmBotHold`, `cancelBotHoldDraft` and `hasBotHoldDraft`. The `ai` module calls them from `hold-tools.ts` (tools `check_availability`, `prepare_hold`, `confirm_hold`, `cancel_hold_draft`). Lodging owns every rule: the bot's sales scope (its property selection, active and fully priced places only), free nights, quotes in sell prices, Vietnamese weekday labels, minimum stays, the party check and phone normalisation (`normalizeVnPhone`). It checks the bot through `BOT_FACADE`. Results carry property and room ids, which the tools strip before the model sees them.
2. **One draft per conversation, 30 minutes.** `prepareBotHold` writes nothing to the calendar. It stores one draft per conversation in `lodging_bot_hold_drafts` (forced RLS, migration 0043) with the selection, party, guest, channel, the bot's name and a sha256 of what the customer saw (`quoteHash`). A new prepare replaces the earlier draft; a prepare that finds problems deletes it. Expired drafts are swept by the next prepare in the business.
3. **Server-built summary and quick replies.** The Vietnamese summary is built in code (`lodging/domain/hold-summary.ts`): place, dates with weekdays, nights, party, total, guest, and how long the hold lasts. The tool sends it with the quick replies `✅ Giữ chỗ` (`HOLD_CONFIRM`) and `✏️ Sửa thông tin` (`HOLD_EDIT`), with the same delivery rules as the order summary (ADR-016 §4): one per turn, kept as the last message, the draft dropped when delivery is incomplete. The model never restates it.
4. **Confirm through the staff booking path, idempotently.** `confirm_hold` is offered only when the customer answered after the summary, never in the turn that prepared it. `confirmBotHold` locks the draft, re-quotes it (a different hash answers `price_changed`), and creates the booking with `BookingService.createIn`, the same transaction and unit-night primary key as a staff hold. The booking has status `hold`, `source = 'bot'`, the conversation and contact links (the contact when the inbox knows it), the workspace's hold time as expiry, and the bot's name as the history actor. Its `clientRequestId` is a uuid v5 of the draft id, so a retried confirm finds the same booking and answers the same `held`; the confirmed draft stays as a tombstone until it is swept. A lost race (`not_available`), a price change, an expired draft or a past check-in answer with alternatives instead of a booking. The bot then says "đã giữ chỗ" with the code and expiry; it never says "đã đặt" or "đã xác nhận".
5. **Review state for staff.** A bot hold waits for staff while `source = 'bot'`, `status = 'hold'` and `reviewed_at` is null (`lodging_bookings.reviewed_at`, `reviewed_by`, migration 0043). The first staff status action or edit sets them; a bot actor never does. `GET /lodging/bookings/review-count` answers `{pending}` and `GET /lodging/bookings?source=bot` lists bot bookings. The web shows a "Bot tạo" badge, the pending count on the "Giữ chỗ" tab and next to "Booking" in the sidebar, a "Nguồn" filter, and in the booking sheet a call-then-confirm hint with "Mở hội thoại".
6. **The facade is the availability seam.** The bot asks the lodging module, not the calendar tables. A later provider (an external PMS or channel manager) can answer `checkAvailabilityForBot` and the hold calls behind the same facade without changing the `ai` tools or the prompt. Adding such a provider needs its own ADR.

## Options considered

- **The bot confirms the booking directly.** Rejected by the owner: a villa stay is a large amount, and staff call every guest before confirming. A hold also expires on its own when nobody follows up, so a wrong bot hold costs at most the hold time.
- **A pending action through the `action` module instead of a lodging draft.** Rejected for the same reason as in ADR-016: an action stores arguments the model wrote. A hold needs the server's quote, the night check and the booking row in one lodging transaction.
- **No drafts: `prepare_hold` places the hold at once.** Rejected: it would take nights for customers who only wanted a price, and the customer would never see a summary to correct before the nights are taken.
- **Reuse the commerce bot order flow (ADR-016).** Rejected: a stay is not a basket of variants with stock. Nights, quotes and holds live only in `lodging`, and `lodging` must not depend on `commerce`.
- **The model computes totals from the catalog rates with `calculate`.** Rejected: weekday mapping, date-range prices, minimum stays and surcharges are rules of the lodging module, and deriving weekdays or adding nights is exactly the arithmetic a model gets wrong. The server returns the totals and the labels.

## Consequences

- Positive: hotel bots answer dated questions from the real calendar, offer alternatives when a place is full, and keep the nights while staff call. Staff see bot holds at a glance and open the conversation from the booking.
- New module edge: `ai` → `lodging/api` (`LODGING_BOT_FACADE`, alongside `LODGING_CATALOG_FACADE`). `lodging` still depends only on `workspace` and `bot`.
- Schema (migration 0043, additive): `lodging_bot_hold_drafts`; `lodging_bookings.reviewed_at`, `reviewed_by` with a partial index for the pending count.
- Prompt `sales-agent@18` (hotel) replaces `@17`: dated questions go to `check_availability`, totals and weekday labels are quoted verbatim, holds follow name + phone → `prepare_hold` → `confirm_hold`. Live evals: groups `lodging-a17` and `lodging-holds`.
- `prepare_hold`, `confirm_hold` and `cancel_hold_draft` need the bot's "Chốt đơn" switch (`orderTaking`); without it a hotel bot only checks availability.
- Placing a hold sets the turn's `orderCreated` flag, so the inbox treats it like a created order.
- Follow-ups: staff notifications for new bot holds; a periodic sweeper for holds and drafts (today both are lazy); external availability providers behind the facade.
