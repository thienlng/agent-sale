# lodging

**Purpose:** Lodging v2 for hotel businesses (T-160): properties (whole villas or per-room homestays) → units → rates → nightly calendar → bookings and blocks. Spec: `docs/superpowers/specs/2026-11-01-lodging-calendar-design.md`.

**Status:** being built. Done: the pure domain (`domain/`: nights, rate rules, quote, booking status machine), the persistence port `application/ports/lodging-store.ts` (`LODGING_STORE`) with its Drizzle adapter (`infrastructure/persistence/`), the setup API (`interface/http/properties.controller.ts`: properties, rooms, weekday rates + surcharges, date-range overrides, settings, bot properties), bookings (`bookings.controller.ts` → `BookingService`: holds, confirmed stays, blocks, edits, status moves, lists) and reads (`calendar.controller.ts` → `CalendarService`: calendar grid, availability, quote). The bot catalog of hotel bots (`application/bot-catalog.ts` + the pure mapping `application/bot-product.ts`) serves the `ai` module.

**HTTP:** `lodgingV2Routes` in `packages/contracts/src/lodging/lodging.routes.ts`. Hotel businesses only (`LodgingAccess.assertHotel` → 404 otherwise). Setup writes need `catalog.manage` (bot properties: `bots.manage`); booking writes need `orders.manage`; reads (incl. `POST /lodging/availability` and `POST /lodging/quote`) need `orders.view`. Errors: `NOT_FOUND` 404, `VALIDATION_FAILED` 400, `CONFLICT` 409; `NIGHTS_TAKEN` / `STALE_VERSION` answer 409 `CONFLICT` with `details.reason` (and `details.codes` for taken nights).

**Owned tables:** `lodging_properties`, `lodging_units`, `lodging_rates`, `lodging_bookings`, `lodging_booking_units`, `lodging_unit_nights`, `lodging_settings`, `lodging_bot_properties` (migration 0041, schema in `packages/db/src/schema/lodging.ts`). Also writes `audit_events` (target types `lodging_property` / `lodging_booking`) and `outbox_events`.

**Public API (`api/`):**

- `LODGING_FACADE` → `LodgingFacade`: `listBotPropertyIds(ws, botId)` — the bot's stored selection, or every active property id when it has none.
- `LODGING_CATALOG_FACADE` → `LodgingCatalogFacade` (`LodgingBotCatalog`): `searchBotCatalog` / `getBotProductsByIds` / `countBotCatalog`, the same shapes as the commerce `CatalogFacade` (structural typing; lodging never imports commerce). Each active, fully priced property the bot sells (no `lodging_bot_properties` rows = every active property) is a `ProductDto`: `id` = property id, `name` = `<code> – <name>`, `category` = area, price range = the lowest/highest weekday sell price, first 5 gallery URLs, no variants, and an `accommodation` (`rentalType` entire_property | rooms, `rateBasis: 'night'`, weekday `rates` of the whole place or else the cheapest room, the active rooms as `units`, upcoming overrides (max 20), surcharges, policies, gallery with a caption on every picture). Sell prices only, never a cost. Search: accent-folded words matched against code, name, area and amenities; `maxPriceVnd` against the lowest price; `inStockOnly` ignored. Without a database every read answers empty.
- Events (outbox, `api/lodging.events.ts`): `lodging.booking.created.v1` `{bookingId, code, propertyId, status, checkIn, checkOut, source}`; `lodging.booking.{confirmed,cancelled,expired,checked_in,checked_out}.v1` `{bookingId, code, propertyId}`. No guest name or phone in any payload.

**Events consumed:** none.

**Invariants:**

- A stay lasts 1–60 nights; nights are local dates, check-out exclusive; weekdays are ISO (Monday = 1) computed from the date in code.
- For each rate target (whole property or one room) weekday rules cover the seven weekdays exactly once; overrides of one target never overlap; an override wins over the weekday rate.
- One `lodging_unit_nights` row per occupied unit-night (PK = anti-double-booking). `takeNights` locks the unit rows (`FOR NO KEY UPDATE`), pre-checks and throws `NIGHTS_TAKEN` with the occupying booking codes; a racing unique violation also maps to `NIGHTS_TAKEN`.
- Holds expire lazily: every lodging transaction that reads or writes bookings (calendar, availability, quote, booking list/detail/writes, property list, sell-mode check) first runs `expireHolds` (`application/booking-support.ts`) — status `expired`, nights freed, a history row and `lodging.booking.expired.v1`.
- Booking create is idempotent by `clientRequestId` (advisory lock + sha256 fingerprint: same payload replays, a different one is `CONFLICT`). An edit releases and re-takes the nights in one transaction, so a conflict keeps the old nights. A store error (`NIGHTS_TAKEN`, 23505/23503) aborts the transaction: never keep using it.
- A new property is added to every bot that has an explicit property list (bots without a list sell all).
- Booking status moves only along the status machine (`domain/booking-status.ts`); check-in only from the check-in date (Asia/Ho_Chi_Minh).

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend exec vitest run src/modules/lodging`
