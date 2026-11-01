# Lodging part 3 — the bot checks the calendar, quotes and places holds (T-161)

- Date: 2026-11-01 · Status: approved by the owner in chat (2026-11-01)
- Builds on: T-160 / ADR-018 (lodging module), ADR-014/015 (tool-calling agent), ADR-016 (bot orders: bot prepares, customer confirms, staff review)
- New ADR: ADR-019 (ai → lodging write path for bot holds)

## 1. Goal

A hotel bot answers "ngày X–Y, N người, còn căn nào, bao nhiêu?" from the real Rapiz calendar, suggests other properties when the asked one is full, and — when the customer agrees and gives a name and phone — places an expiring **hold** that staff then confirm. The bot never confirms a booking, never invents availability and never computes dates or totals itself.

## 2. Flow (mirrors ADR-016)

1. `check_availability` (read-only tool) → server answers with options computed by the lodging module.
2. `prepare_hold` → server validates, stores one draft per conversation (30 min), sends a server-built Vietnamese summary with quick replies **✅ Giữ chỗ** (`HOLD_CONFIRM`) / **✏️ Sửa thông tin** (`HOLD_EDIT`).
3. Customer answers after the summary → `confirm_hold` creates the booking with status `hold`, `source = 'bot'`, conversation/contact links, expiry from the workspace's `holdMinutes`; the bot tells the customer the code and expiry. `cancel_hold_draft` discards the draft.
4. Staff see bot holds (badge "Bot tạo", pending count), open the conversation, confirm / extend / cancel.

## 3. Lodging module (owner of every rule)

New `LodgingBotFacade` methods on `lodging/api` (ai calls them; `lodging` never imports `ai`):

- `checkAvailabilityForBot(ws, {botId, checkIn, checkOut, adults, childAges, propertyId?})` → `{ nights, checkInWeekday, checkOutWeekday, options: [{ propertyId, code, name, whole, unitNames, fits, overStandard, totalSell, nightly: [{date, weekdayLabel ('Thứ Sáu'…), label, sell}], surcharges }], requestedFull: boolean }`. Only properties the bot sells (lodging_bot_properties semantics), active, fully priced. If `propertyId` is given and it is not free, `requestedFull = true` and the other fitting options are returned as alternatives (max 5, fits first, then price). Never returns cost prices. Dates validated (check-in ≥ local today, 1–60 nights).
- `prepareBotHold(ws, {botId, conversationId, contactId?, channel, propertyId, whole, unitIds?, checkIn, checkOut, adults, childAges, guestName, guestPhone, note?})` → `{status: 'ready', summary, expiresInMinutes} | {status: 'problems', problems: ('missing_name'|'missing_phone'|'invalid_phone'|'not_available'|'not_sold'|'over_max'|'missing_rate'|'past_date')[], alternatives?}`. Phone normalised with `normalizeVnPhone`. Re-checks availability (no write to nights). Stores one draft per conversation in `lodging_bot_hold_drafts` (replaces an earlier one; expires after 30 min; holds the selection, party, guest, quote hash). Summary built in code, e.g. `Giữ chỗ SKY VILLA A17\n06/11 (T6) → 08/11 (CN) · 2 đêm\n20 người lớn\nTổng: 27.000.000đ\nTên: Anh Nam · SĐT: 0901…\nGiữ trong 2 giờ, nhân viên sẽ gọi xác nhận.`
- `confirmBotHold(ws, {conversationId})` → `{status: 'held', code, holdExpiresAt} | {status: 'expired'|'not_available'|'price_changed'|'no_draft', alternatives?}`. Locks the draft, re-quotes (hash must match, else `price_changed`), creates the booking through the same booking service path as staff (unit-night PK, idempotent `clientRequestId` derived from draft id), deletes the draft, emits `lodging.booking.created.v1` with `source: 'bot'`.
- `cancelBotHoldDraft(ws, {conversationId})`, `hasBotHoldDraft(ws, conversationId)` → `{pending, storedAt}`.
- Migration `0043_lodging_bot_holds.sql`: `lodging_bot_hold_drafts` (forced RLS) and `lodging_bookings.reviewed_at timestamptz null`, `reviewed_by uuid null` — a bot hold counts as "chờ xử lý" while `source = 'bot' AND status = 'hold' AND reviewed_at IS NULL`; any staff status action or edit sets `reviewed_at`.
- HTTP: `GET /lodging/bookings/review-count` → `{pending}`; bookings list filter `source=bot` (additive).

## 4. AI module

- New `hold-tools.ts` (pattern of `order-tools.ts`): tools `check_availability` (readOnly), `prepare_hold`, `confirm_hold`, `cancel_hold_draft`; confirm/cancel only offered when a draft from before the customer's newest message exists (`answeredSince`, `confirmableDraft` reused/generalised). `keepSummaryLast` and the created-code announcement generalised to take the confirm payload and the line text ("Dạ em đã giữ chỗ {code} đến {HH:mm} ạ. Nhân viên sẽ gọi xác nhận sớm ạ.").
- Hotel bots get these tools (no retail order tools). Requires the bot setting `orderTaking` to be on (reuse the existing switch as "bot được chốt/giữ chỗ"); with it off the bot only gets `check_availability`.
- Prompt `sales-agent@18` (hotel): use `check_availability` for any dated question; quote the server's totals and weekday labels verbatim; say "còn trống" / "đã kín" only from a tool result of this turn; when full, offer the alternatives; ask check-in, check-out, adults and children's ages if missing; when the customer wants to keep it, ask name + phone then `prepare_hold`; never say "đã đặt"/"đã xác nhận" — only "đã giữ chỗ" after `confirm_hold`. Relative dates ("cuối tuần này", "mùng 2 Tết") are resolved by the model using today's date in the prompt, then echoed back with the server's weekday labels so the customer can correct them.
- Evals (live, group `lodging-holds`): free dates quote; requested property full → alternatives; party over standard; missing dates → asks; hold flow prepare → confirm → code; hold lost to another booking between prepare and confirm → apologises with alternatives. Existing `lodging-a17` cases updated to @18.

## 5. Web

- Booking page "Giữ chỗ" tab: badge **Bot tạo** on bot holds, a pending count in the tab and in the sidebar "Booking" item (like orders review count); filter "Nguồn: Bot".
- Booking sheet: for bot holds, a "Mở hội thoại" button and a hint "Bot đã giữ chỗ theo yêu cầu khách — gọi xác nhận rồi bấm Xác nhận".

## 6. Testing

Domain/unit: summary text, availability option ranking, problems. Integration: prepare/confirm happy path, confirm after someone else took the nights → `not_available` + alternatives, price change → `price_changed`, draft expiry, RLS, review count. AI: tool gating (confirm only after the customer answered), summary kept last, code announced once, hotel bot without orderTaking gets only check_availability. Web: badge, count, filter. `pnpm check` green; live evals `lodging-a17` + `lodging-holds`.

## 7. Out of scope

Deposits/payments (dropped), owner roles (dropped), external PMS availability sources (the facade is the seam; a later ADR adds providers), Zalo notifications to staff.
