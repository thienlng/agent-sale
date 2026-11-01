# lodging

**Purpose:** Places to stay for hotel businesses (T-160, [ADR-018](../../../../../docs/adr/ADR-018-lodging-module.md)): properties sold whole (villa) or per room (homestay) → units → rates (weekday + date-range overrides + surcharges, sell and cost) → nightly calendar → holds, bookings and blocks. Operator guide and API table: [docs/lodging.md](../../../../../docs/lodging.md). Spec: `docs/superpowers/specs/2026-11-01-lodging-calendar-design.md`.

**Layout:** `domain/` pure rules (nights, rate rules, `quoteStay`, booking status machine). `application/` services (`PropertyService`, `RatesService`, `LodgingSettingsService`, `BookingService`, `CalendarService`, `NightNotesService`), the bot catalog (`bot-catalog.ts` + pure mapping `bot-product.ts`), the bot holds (`bot-hold.service.ts` + `bot-hold-support.ts`; free-option search shared with the calendar in `availability.ts`) and the store port `ports/lodging-store.ts` (`LODGING_STORE`). `infrastructure/persistence/` Drizzle adapter. `interface/http/` three controllers under `@Controller('lodging')`.

**Depends on:** `workspace` (`WORKSPACE_FACADE`, industry check) and `bot` (`BOT_FACADE`). Never on `commerce` or any other tier-2 module.

**Owned tables** (migrations 0041, 0042 and 0043, schema `packages/db/src/schema/lodging.ts`): `lodging_properties`, `lodging_units`, `lodging_rates`, `lodging_settings`, `lodging_bookings`, `lodging_booking_units`, `lodging_unit_nights`, `lodging_bot_properties`, `lodging_night_notes`, `lodging_bot_hold_drafts`. Also writes `audit_events` (targets `lodging_property`, `lodging_booking`, `lodging_settings`, `bot`) and `outbox_events`.

**HTTP:** `lodgingV2Routes` (`packages/contracts/src/lodging/lodging.routes.ts`). Hotel businesses only (`LodgingAccess.assertHotel`, 404 otherwise).
- `GET /lodging/bookings/review-count` → `{pending}` (bot holds not reviewed yet); `GET /lodging/bookings?source=bot` filters by source.
- Capabilities: reads `orders.view`; property, room, rate, override and settings writes `catalog.manage`; bot properties PUT `bots.manage`; booking writes and night notes (`PUT properties/{id}/notes`) `orders.manage`.
- Errors: `NOT_FOUND` 404, `VALIDATION_FAILED` 400, `CONFLICT` 409. `NIGHTS_TAKEN` / `STALE_VERSION` answer 409 `CONFLICT` with `details.reason` (and `details.codes` for taken nights).

**Public API (`api/`):**
- `LODGING_FACADE` → `LodgingFacade.listBotPropertyIds(ws, botId)`: the bot's selection, or every active property id when it has none.
- `LODGING_CATALOG_FACADE` → `LodgingCatalogFacade` (`LodgingBotCatalog`): `searchBotCatalog` / `getBotProductsByIds` / `countBotCatalog`, the same shapes as the commerce `CatalogFacade` (structural typing). Each active, fully priced property the bot sells becomes a `ProductDto` with an `accommodation` (`rentalType` `entire_property | rooms`, `rateBasis: 'night'`, whole-place weekday `rates` — its own rules or the per-weekday sum of the active rooms —, room prices in `units`, upcoming overrides with `(min N nights)` in the label, surcharges, policies, captioned gallery). Sell prices only, never a cost. Without a database every read answers empty.
- `LODGING_BOT_FACADE` → `LodgingBotFacade` (`LodgingBotHolds`, T-161, spec `docs/superpowers/specs/2026-11-01-bot-lodging-holds-design.md` §3), called by `ai`:
  - `checkAvailabilityForBot(ws, {botId, checkIn, checkOut, adults, childAges, propertyId?})` → nights, Vietnamese weekday labels, `requestedFull`, at most 5 options (fits first, then price; `rankForBot`) with `unitIds`, `unitNames`, `fits`, `overStandard`, `totalSell`, nightly sells with `weekdayLabel`, surcharges in sell only, and `problems` (`past_date`, `too_long`, `not_sold`). Properties = the bot catalog's (selection or every active one, fully priced); an option breaking a min-stay rule is not offered.
  - `prepareBotHold` → `{status: 'ready', summary, holdMinutes}` or `{status: 'problems', problems, alternatives}`; phone through `normalizeVnPhone` (stored `0xxxxxxxxx`); never writes nights; stores one draft per conversation (30 min, replaces an earlier one) with a sha256 of what the customer saw (`quoteHash`). Summary text: `domain/hold-summary.ts`.
  - `confirmBotHold` → `held {code, holdExpiresAt}` or `expired | no_draft | price_changed | not_available` with alternatives. Locks the draft, re-quotes (hash mismatch = `price_changed`), creates the hold through `BookingService.createIn` (status `hold`, source `bot`, actor = the bot's name, `clientRequestId` = uuid v5 of the draft id so a retry replays), deletes the draft in the same transaction. On failure the transaction rolls back and the draft (that version) is deleted in a new one.
  - `cancelBotHoldDraft`, `hasBotHoldDraft` → `{pending, storedAt}`.
- Events (outbox, `api/lodging.events.ts`), aggregate `lodging_booking`:
  - `lodging.booking.created.v1` `{bookingId, code, propertyId, status, checkIn, checkOut, source}`
  - `lodging.booking.{confirmed,cancelled,expired,checked_in,checked_out}.v1` `{bookingId, code, propertyId}`

**Events consumed:** none.

**Invariants:**
- One `lodging_unit_nights` row per occupied unit-night; its PK `(workspace_id, unit_id, night)` is the only anti-double-booking rule. `takeNights` locks the unit rows (`FOR NO KEY UPDATE`), pre-checks and throws `NIGHTS_TAKEN` with the occupying codes; a racing 23505 maps to `NIGHTS_TAKEN` too. A whole rental of a rooms property takes every active room.
- Occupying statuses: `hold`, `confirmed`, `checked_in`, `checked_out`, block `active`. Cancel, expiry, no-show and block removal delete the nights in the same transaction.
- Lazy hold expiry: every lodging transaction that reads or writes bookings (calendar, availability, quote, booking list/detail/writes, property list, sell-mode check) first runs `expireHolds` — status `expired`, nights freed, history row, `lodging.booking.expired.v1`. No worker sweeps yet.
- A stay lasts 1–60 nights; nights are local dates, check-out exclusive; weekdays are ISO, computed from the date in code; "today" and check-in use Asia/Ho_Chi_Minh.
- Per rate target (whole property or one room) weekday rules cover the seven weekdays exactly once; overrides of one target never overlap and win over weekday rules.
- Create is idempotent by `clientRequestId` (advisory lock + sha256 fingerprint). Only an edit that changes dates, units or party re-quotes at today's rates; only a change of dates or units releases and re-takes the nights (one transaction). Any other edit keeps `unitIds`, `quote` and the nights; its total is the stored base (manual price or `quote.totalSell`) + the new adjustment, unless `manualTotalSell` is sent; a stay without a stored quote (migrated from T-155) keeps `totalSell - adjustment` and `totalCost` as its base. Units compare as a set, child ages in order (web and server alike). An edit that changes dates, units or party of a manually priced stay must send `manualTotalSell` (a number, or `null` for the quote) — checked-in stays too. A checked-in stay may change only `checkOut`, `manualTotalSell`, `adjustment`, `adjustmentReason`, `tags`. Bookings of a paused property stay editable; create is refused.
- `replaceUnits` refuses (409, `details.codes`) to add or reactivate a room while a whole booking that is not checked out has `check_out > today`.
- Early check-out: `check_out` before the booked check-out sets `checkOut = max(checkIn + 1, today)`, releases the later nights, re-quotes an automatic price (keeps it when a night has no rate; total floored at 0) and keeps a manual one; the audit row carries `checkOut {from, to}`.
- A status move or edit of an `expired` hold answers 409 `details.reason = 'HOLD_EXPIRED'` (before the version check, so a hold expired lazily in the same request says so).
- Optimistic `version` on properties and bookings (`STALE_VERSION`).
- Bot holds: a hold with `source = 'bot'` waits for staff while `status = 'hold'` and `reviewed_at` is null; the first staff status action or edit of a bot booking sets `reviewed_at` / `reviewed_by` (a bot actor never does). Bot results never carry a cost, the internal note, night notes or tags.
- Status moves follow `domain/booking-status.ts` only.
- Event payloads never carry the guest's name or phone. Bot products never carry a cost, the property's `internalNote`, night notes or booking tags (`bot-product.ts` maps none of them; `bot-catalog.spec.ts` asserts the internal note).
- Night notes (`lodging_night_notes`): one per (property, unit or null, night), text 1–300 chars; an empty text deletes; a `unitId` must be a room of a rooms property. Staff-only, internal.
- Booking tags: ≤ 8, each ≤ 30 chars, trimmed and de-duplicated by `normalizeTags`; stays only (a block has none); a checked-in stay may change them; labels only, never part of pricing. `listBookings` filters with `tags @> array[tag]`.
- A new property is added to every bot that has an explicit property list.
- After a store error (`NIGHTS_TAKEN`, 23505, 23503) the transaction is aborted: never keep using it.

**Do not:** read or write other modules' tables; import `commerce`; put HTTP or Drizzle types in `domain/`; call LLMs; query rates per property in a loop (use `ratesByProperty`).

**Test:**
- `pnpm --filter @agent-sales/backend exec vitest run src/modules/lodging`
- `pnpm --filter @agent-sales/backend exec vitest run --config vitest.integration.config.ts test/lodging` (needs Docker for Testcontainers)
