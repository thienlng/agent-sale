# lodging

**Purpose:** Lodging v2 for hotel businesses (T-160): properties (whole villas or per-room homestays) → units → rates → nightly calendar → bookings and blocks. Spec: `docs/superpowers/specs/2026-11-01-lodging-calendar-design.md`.

**Status:** being built. So far only the pure domain exists (`domain/`: nights, rate rules, quote, booking status machine); tables, facade, routes and events follow in later T-160 steps.

**Owned tables:** none yet (planned: `lodging_properties`, `lodging_units`, `lodging_rates`, `lodging_bookings`, `lodging_booking_units`, `lodging_unit_nights`, `lodging_settings`, `lodging_bot_properties`; schema in `packages/db/src/schema/lodging.ts`).

**Public API (`api/`):**
- `LODGING_FACADE` → `LodgingFacade` (no use cases yet)
- Events: none yet (planned `lodging.booking.<verb>.v1`)

**Events consumed:** none.

**Invariants:**
- A stay lasts 1–60 nights; nights are local dates, check-out exclusive; weekdays are ISO (Monday = 1) computed from the date in code.
- For each rate target (whole property or one room) weekday rules cover the seven weekdays exactly once; overrides of one target never overlap; an override wins over the weekday rate.
- Booking status moves only along the status machine (`domain/booking-status.ts`); check-in only from the check-in date (Asia/Ho_Chi_Minh).

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend exec vitest run src/modules/lodging`
