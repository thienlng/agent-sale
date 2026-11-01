# lodging

**Purpose:** Lodging v2 for hotel businesses (T-160): properties (whole villas or per-room homestays) → units → rates → nightly calendar → bookings and blocks. Spec: `docs/superpowers/specs/2026-11-01-lodging-calendar-design.md`.

**Status:** being built. Done: the pure domain (`domain/`: nights, rate rules, quote, booking status machine), the persistence port `application/ports/lodging-store.ts` (`LODGING_STORE`) with its Drizzle adapter (`infrastructure/persistence/`), and the setup API (`interface/http/properties.controller.ts`: properties, rooms, weekday rates + surcharges, date-range overrides, settings, bot properties). Bookings, calendar, availability, quote and events follow in later T-160 steps.

**HTTP:** `lodgingV2Routes` in `packages/contracts/src/lodging/lodging.routes.ts`. Hotel businesses only (`LodgingAccess.assertHotel` → 404 otherwise). Setup writes need `catalog.manage` (bot properties: `bots.manage`); reads need `orders.view`. Errors: `NOT_FOUND` 404, `VALIDATION_FAILED` 400, `CONFLICT` 409; `NIGHTS_TAKEN` / `STALE_VERSION` answer 409 `CONFLICT` with `details.reason` (and `details.codes` for taken nights).

**Owned tables:** `lodging_properties`, `lodging_units`, `lodging_rates`, `lodging_bookings`, `lodging_booking_units`, `lodging_unit_nights`, `lodging_settings`, `lodging_bot_properties` (migration 0041, schema in `packages/db/src/schema/lodging.ts`). Also writes `audit_events` (target types `lodging_property` / `lodging_booking`) and `outbox_events`.

**Public API (`api/`):**

- `LODGING_FACADE` → `LodgingFacade` (no use cases yet)
- Events: none yet (planned `lodging.booking.<verb>.v1`)

**Events consumed:** none.

**Invariants:**

- A stay lasts 1–60 nights; nights are local dates, check-out exclusive; weekdays are ISO (Monday = 1) computed from the date in code.
- For each rate target (whole property or one room) weekday rules cover the seven weekdays exactly once; overrides of one target never overlap; an override wins over the weekday rate.
- One `lodging_unit_nights` row per occupied unit-night (PK = anti-double-booking). `takeNights` locks the unit rows (`FOR NO KEY UPDATE`), pre-checks and throws `NIGHTS_TAKEN` with the occupying booking codes; a racing unique violation also maps to `NIGHTS_TAKEN`.
- Booking status moves only along the status machine (`domain/booking-status.ts`); check-in only from the check-in date (Asia/Ho_Chi_Minh).

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend exec vitest run src/modules/lodging`
