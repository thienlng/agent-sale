# ADR-018: Lodging module — properties, rates, nightly calendar and bookings

- Status: Proposed
- Date: 2026-11-01
- Decision makers: thienlng
- Supersedes in part: [ADR-013](ADR-013-lodging-catalog-and-stay-requests.md) (accommodation as a commerce product, stay requests)
- Spec: [lodging part 1](../superpowers/specs/2026-11-01-lodging-calendar-design.md) (T-160)

## Context

The owner runs central sales for 20–30 villas in the Tam Đảo golf resort, with 400–500 conversations a day. Until now each villa's calendar lived in a Google Sheet kept by the villa's manager: one row per night, statuses Trống / Đã đặt / Giữ chỗ / Khóa, and a booking code column. A sales agent could not tell from Rapiz which villa was free on given nights.

The T-155 slice ([ADR-013](ADR-013-lodging-catalog-and-stay-requests.md)) stores a villa as a retail product with accommodation metadata, and keeps an unconfirmed list of stay requests. It has no calendar, no holds and no per-room selling, and the hotel UI and bot training still say "sản phẩm".

Owner decisions (2026-11-01):

1. Rapiz is the only source of truth for the calendar. The Google Sheets are dropped.
2. Each property is sold either as a whole (a villa) or per room (a homestay). A whole rental of a per-room property takes every room, and a room booking blocks a whole rental.
3. Rates are weekday base prices plus date-range overrides (holidays, Tết, peak) and extra-guest surcharges. Every price has a sell and a cost price (what the owner receives).
4. Next: bot calendar, quote and hold tools (part 3). Not planned (owner, 2026-11-01): per-property owner accounts — whoever uses Rapiz keeps the calendar current — and a money ledger, which is accounting/PMS work outside an AI sales agent.

## Decision

1. **Own tier-2 module `lodging`** (created with `pnpm gen module lodging`). It owns eight tables (`lodging_properties`, `lodging_units`, `lodging_rates`, `lodging_settings`, `lodging_bookings`, `lodging_booking_units`, `lodging_unit_nights`, `lodging_bot_properties`; migration `0041_lodging.sql`). It depends only on `workspace` and `bot`, never on `commerce`. Bookings keep `contactId` / `conversationId` as plain ids plus a guest name/phone snapshot.
2. **The unit-night primary key is the single anti-double-booking rule.** `lodging_unit_nights` has primary key `(workspace_id, unit_id, night)`. Every hold, confirmed stay, in-house stay, checked-out stay and active block owns one row per unit per night. Cancelling, expiring, no-show and removing a block delete the rows in the same transaction. Writers lock the unit rows (`FOR NO KEY UPDATE`), pre-check and answer `409 NIGHTS_TAKEN` with the occupying booking codes. A racing unique violation also maps to `NIGHTS_TAKEN`.
3. **A whole rental of a rooms property takes every active room.** Whole-vs-room cross-blocking then needs no extra logic: both kinds of booking write the same unit-night rows.
4. **Lazy hold expiry, no worker.** The `worker` process runs no job processors yet. Every lodging transaction (calendar, availability, quote, booking list, detail and writes, property list) first expires the workspace's overdue holds: status `expired`, nights deleted, a history row and `lodging.booking.expired.v1`. Nobody can see or be blocked by an overdue hold.
5. **Rapiz is the source of truth.** There is no import from or sync to Sheets, iCal or an OTA. The calendar the staff and, later, the bot read is the one in Rapiz.
6. **Hotel bots read properties through a structural catalog facade.** `lodging` exports `LODGING_CATALOG_FACADE` with the same three method shapes as the commerce `CatalogFacade` and returns `ProductDto` rows whose `accommodation` is built from the property (sell prices only). `ai` picks this facade for hotel bots, so the reply pipeline, tools and image allowlist stay unchanged. Prompt `sales-agent@17` quotes nightly prices but never claims a night is free or held. Hotel bots get no commerce order tools.
7. **T-155 stays served but deprecated.** `/stay-requests…`, the `stay_requests` table and `products.accommodation` remain (migration 0041 copies accommodation products into whole properties and confirmed stay requests into bookings). No UI uses them. They are removed in a later contract step (rule 05: expand → migrate → contract).

## Options considered

1. **Keep commerce products and add a calendar to them.** Rejected: a calendar, holds, per-room selling, nightly rates and cost prices do not fit retail products and variants, and every retail screen would need hotel exceptions. Commerce would grow a second domain it does not own.
2. **Build the generic resources / availability / appointments model of [docs/17](../17-multi-tenancy-and-verticals.md) §4.** Deferred: the business need is nightly occupancy of whole villas and rooms, with prices per night. The generic model has no nightly rate or whole-vs-room rule yet and would take much longer to ship. A later generic model can migrate these tenant-owned rows.
3. **Integrate an external PMS or channel manager.** Rejected for now: the owner's villas have no PMS, the source of truth was a set of Sheets, and the owner decided Rapiz becomes the source of truth.

## Consequences

- Hotel businesses get three new screens: Lịch (`/app/calendar`), Booking (`/app/bookings`) and Căn (`/app/properties`). `/app/accommodations` and `/app/stays` redirect to them.
- Double booking is impossible by construction, including under concurrent requests, as long as every writer goes through `takeNights`.
- Without a sweeper an overdue hold is expired only by the next lodging transaction of its workspace. That is enough for the screens and the bot, which always read through such a transaction. When the worker gets job processors, add a periodic sweep so `lodging.booking.expired.v1` is emitted on time for consumers.
- Event payloads (`lodging.booking.*.v1`) carry ids, codes, dates, status and source only, never the guest's name or phone.
- Part 3 gives the bot availability, quote and hold tools, behind an availability source so an external PMS can feed the same tools later (ADR-017 pattern). Owner roles and a money ledger are out of scope; revisit only with a new ADR.
- A follow-up contract step removes the T-155 routes, the `stay_requests` table and `products.accommodation`.
