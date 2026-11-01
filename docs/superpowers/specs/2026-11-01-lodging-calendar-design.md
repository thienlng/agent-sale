# Lodging part 1 — properties, rates, calendar and bookings (T-160)

- Date: 2026-11-01
- Status: approved by the owner in chat (2026-11-01)
- Replaces in part: ADR-013 (whole-property accommodation as a commerce product + stay requests)
- New ADR: ADR-018 `lodging` module

## 1. Why

The current hotel slice (T-155, ADR-013) stores a villa as a retail product with accommodation metadata and offers an unconfirmed "stay request" list. It has no calendar, the UI and bot training still say "sản phẩm", and nothing can tell a sales agent which villa is free on given nights. The owner runs central sales for 20–30 villas in the Tam Đảo golf resort (400–500 conversations a day). Until now each villa's calendar lived in a Google Sheet kept by the villa's manager (one row per night; statuses Trống / Đã đặt / Giữ chỗ / Khóa; a booking code column).

Owner decisions (2026-11-01):

1. **Rapiz is the only source of truth for the calendar.** Google Sheets are dropped.
2. **Sell mode per property**: whole property (villa, e.g. A17) or per room (homestay). A whole rental of a per-room property takes every room; room bookings block a whole rental.
3. ~~Restricted owner accounts (part 2)~~ — dropped 2026-11-01: whoever runs the calendar in Rapiz (the owner, or the sales team after contacting the owner) keeps it up to date; no per-property roles.
4. The bot looks up the real calendar, quotes exact prices and places expiring holds; only people confirm (**part 3**).
5. ~~Money ledger per booking (part 4)~~ — dropped 2026-11-01: deposits, payments, owner payout and commission are accounting/PMS work outside an AI sales agent; at most an export later.
6. Rates: weekday base + date-range overrides (holidays, Tết, peak) + extra-guest surcharges, each with a sell price and a cost price (what the owner receives).

This spec covers **part 1**: data foundation, rates, calendar, bookings operated by staff, A17 migration and keeping the bot working on the new model. Part 3 (bot tools) gets its own spec; parts 2 and 4 were dropped (see decisions 3 and 5).

## 2. Vocabulary (UI, i18n, prompts, docs)

| Concept | Code | Vietnamese UI |
|---|---|---|
| Property (villa/homestay) | `property` | Căn |
| Sellable unit (whole property or room) | `unit` | Phòng / Nguyên căn |
| Booking (stay) | `booking` (kind `stay`) | Booking |
| Calendar block (repair, owner use) | `booking` (kind `block`) | Khoá lịch |
| Hold | status `hold` | Giữ chỗ |
| Night | `night` (the check-in date of one night) | Đêm |

The word "sản phẩm" never appears in a hotel business: sidebar, bot training, inbox sales panel, empty states and bot prompts all use the words above.

## 3. Domain model (new backend module `lodging`, tier 2)

Created with `pnpm gen module lodging`. It depends on no other tier-2 module (bookings keep `contactId` / `conversationId` as plain ids plus a guest name/phone snapshot). `ai` reads it through `LodgingFacade`. All tables carry `workspace_id`, forced RLS, UUIDv7 ids, money as integer VND (`bigint`), timestamps `timestamptz`. Only hotel-industry businesses can use the routes (`409 INDUSTRY_MISMATCH` otherwise).

### 3.1 Property — `lodging_properties`

`code` (short, unique per workspace, e.g. `A17`), `name`, `area` (e.g. "Sân golf Tam Đảo"), `address`, `description`, `sellMode` (`whole` | `rooms`), `status` (`active` | `paused`), `standardAdults`, `standardChildren`, `maxGuests` (nullable hard cap), `childFreeBelow` (age, exclusive: children younger than this count against `standardChildren` and pay nothing extra), `childAdultFrom` (age from which a child counts as an adult), `amenities` (string list), `layout` (descriptive rooms list `{name, beds, note}` — for a whole-property villa this is what A17's eight bedrooms are), `policies` (`checkInTime`, `checkOutTime`, `deposit`, `cancellation`, `houseRules`, `other`: free text, empty = unknown), `gallery` (`{url, caption}[]`, up to 30), `sortOrder`, `version`.

### 3.2 Units — `lodging_units`

`propertyId`, `kind` (`whole` | `room`), `name`, `beds`, `capacityAdults`, `capacityChildren`, `active`, `sortOrder`.

- A `whole` property has exactly one unit of kind `whole` (created and kept by the service, not edited in the UI).
- A `rooms` property has one or more `room` units. Renting the whole of it books every active room unit.

### 3.3 Rates — `lodging_rates`

One row per price rule: `propertyId`, `unitId` (null = the whole property; set = one room), `kind` (`weekday` | `override`), `weekdays` (ISO 1–7, for `weekday`), `dateFrom`/`dateTo` (inclusive nights, for `override`), `label` (e.g. "Tết 2027"), `sell`, `cost`, `minNights` (override only, optional).

Invariants: for each target (property-whole or one room) the weekday rows cover the seven weekdays exactly once; overrides for one target never overlap. A `whole` property has whole-target rates only. A `rooms` property has per-room rates and may also have whole-target rates (the price for renting the whole place); without them a whole rental of a `rooms` property costs the sum of its rooms.

Surcharges live on the property: `extraAdult` and `extraChild` (sell + cost, per person per night). A child younger than `childFreeBelow` is free within `standardChildren`; a child from `childFreeBelow` to below `childAdultFrom` pays `extraChild` when above standard; a child at `childAdultFrom` or older counts as an adult.

### 3.4 Quote (pure domain function)

`quoteStay(property, units, rates, {checkIn, checkOut, unitIds | whole, adults, childAges})` → `{nights: [{date, weekday, label, sell, cost}], surcharges: [{kind, persons, nights, sell, cost}], totalSell, totalCost, warnings[]}`.

- Per night: the matching override wins, otherwise the weekday rate. The weekday comes from the date in code (never from the model).
- Standard capacity: whole target → property standard; rooms → the sum of selected rooms' capacities. Above `maxGuests` → warning `over_max` (staff may still save; the bot must not, part 3).
- Warnings: `min_nights` (an override demands more nights), `missing_rate` (no rule for a night: quote has no total, staff enters the price manually), `child_ages_missing`.
- Max 60 nights per stay.

### 3.5 Bookings — `lodging_bookings`, `lodging_booking_units`, `lodging_unit_nights`

`lodging_bookings`: `code` (`BK-0001`, per-workspace sequence), `propertyId`, `kind` (`stay` | `block`), `whole` (bool), `status`, `checkIn`, `checkOut`, `adults`, `childAges` (int[]), `guestName`, `guestPhone`, `contactId`, `conversationId`, `source` (`messenger` | `zalo` | `phone` | `walk_in` | `owner` | `ota` | `bot` | `other`), `holdExpiresAt`, `quote` (snapshot jsonb), `adjustment` (signed VND with a reason), `totalSell`, `totalCost`, `note`, `blockReason`, `createdBy`, `version`.

`lodging_booking_units(bookingId, unitId)` — which units a booking takes.

`lodging_unit_nights(workspace_id, unit_id, night, booking_id)` with **primary key `(workspace_id, unit_id, night)`** — the single anti-double-booking rule. A row exists for every night × unit of every booking that occupies the calendar (`hold`, `confirmed`, `checked_in`, `checked_out`, active `block`). Cancelling, expiring or marking no-show deletes its rows in the same transaction. A concurrent insert of the same unit-night fails with `409 NIGHTS_TAKEN` listing the conflicting booking codes. Whole-vs-room cross-blocking needs no special logic because a whole rental takes every room's rows.

Status machine (kind `stay`):

```
hold ──confirm──▶ confirmed ──check-in──▶ checked_in ──check-out──▶ checked_out
 │                  │   └──no-show──▶ no_show
 ├──cancel──▶ cancelled ◀──cancel──┘
 └──(time)──▶ expired
```

- A hold has `holdExpiresAt` = now + the workspace's `holdMinutes` (default 120, settings 15–1440). Staff can extend it.
- Expiry is lazy and needs no worker (the `worker` process runs no job processors yet): every lodging transaction (calendar, availability, quote, bookings list/detail, any booking write) first runs `expireOverdueHolds(now)` for the workspace — status `expired`, nights deleted, `lodging.booking.expired.v1` emitted — so nobody can observe or be blocked by an overdue hold. A periodic sweep can be added when the worker gets processors.
- Check-in is allowed from the check-in date (local time Asia/Ho_Chi_Minh); check-out after check-in.
- `block` bookings have status `active` | `removed`, no guest and no money.
- Editing dates/units/party of a `hold` or `confirmed` booking re-quotes and re-takes the nights atomically (all or nothing); the old quote is kept in the audit trail. `checked_in` bookings can only extend/shorten the check-out date.
- Optimistic `version` on every update (`409 STALE_VERSION`).
- Events (outbox): `lodging.booking.created.v1`, `.confirmed.v1`, `.cancelled.v1`, `.expired.v1`, `.checked_in.v1`, `.checked_out.v1`. Conversion event for analytics: `booking_confirmed`.

### 3.6 Settings — `lodging_settings`

`holdMinutes`, `bookingSeq`. One row per workspace, created on first use.

### 3.7 Bot properties — `lodging_bot_properties(botId, propertyId)`

Which properties each bot sells. New bots and newly created properties default to "every bot of the business sells it". Edited from the bot training page "Căn & phòng".

## 4. HTTP API (`packages/contracts/src/lodging/lodging.routes.ts`)

Capabilities: properties/units/rates/settings use `catalog.manage` (read with `orders.view`); calendar, availability, quote and bookings read with `orders.view`, write with `orders.manage`.

| Route | Purpose |
|---|---|
| `GET /lodging/properties` · `POST /lodging/properties` | List (with units, today's status) · create |
| `GET/PATCH /lodging/properties/{id}` | Detail · update info/policies/gallery/standard/sell mode (sell-mode change only without future bookings) |
| `PUT /lodging/properties/{id}/units` | Replace the room list (a unit with future nights cannot be removed, only deactivated after its bookings) |
| `PUT /lodging/properties/{id}/rates` | Weekday rates + surcharges, validated as a whole |
| `POST /lodging/properties/{id}/overrides` · `PATCH/DELETE …/overrides/{rateId}` | Date-range prices |
| `GET /lodging/calendar?from&to&propertyIds` | Properties → units → per-night price + occupying booking segments (≤ 62 nights) |
| `POST /lodging/availability` | `{checkIn, checkOut, adults, childAges, propertyIds?}` → properties that are free (whole) or have free rooms, fit flags and quote totals |
| `POST /lodging/quote` | Quote for a concrete selection, no write |
| `GET /lodging/bookings?view=today|holds|upcoming|all&propertyId&status&q&offset` | Lists |
| `GET /lodging/bookings/{id}` | Detail incl. history |
| `POST /lodging/bookings` | Create hold / confirmed booking / block; `clientRequestId` makes it idempotent |
| `PATCH /lodging/bookings/{id}` | Edit (re-quote, re-take nights) |
| `POST /lodging/bookings/{id}/status` | `confirm`, `check_in`, `check_out`, `cancel` (reason), `no_show`, `extend_hold`, `remove_block` |
| `GET/PATCH /lodging/settings` | Hold minutes |
| `GET/PUT /lodging/bots/{botId}/properties` | Bot's property selection |

The T-155 routes (`/stay-requests…`, accommodation fields on products) stay served but deprecated (no UI); they are removed in a follow-up contract step with the `stay_requests` table and `products.accommodation` column (rule 05: additive API, expand → migrate → contract).

## 5. Screens (hotel business)

Sidebar (hotel): **Lịch** · **Booking** · **Căn** replace "Lưu trú/Yêu cầu lưu trú". `/app/accommodations` and `/app/stays` redirect to the new pages. All strings in `packages/i18n` (vi, en). Built from shadcn/ui components and tokens only; Rapiz orange as the accent.

### 5.1 Lịch — `/app/calendar` (home page for sales)

- Toolbar: ◀ Hôm nay ▶, range **2 tuần** / **Tháng**, area filter, "Chỉ căn còn trống".
- **Tìm trống** bar: check-in → check-out, adults, children (+ ages). Result: rows that fit are highlighted with their total price and a **Giữ chỗ** button; others are dimmed. This answers the most frequent question ("ngày X–Y, N người, còn căn nào?") in one step.
- Grid: sticky header (weekday + date; weekends and override nights shaded and labelled, e.g. "Tết") and sticky first column (code, name, capacity). A row per property; `rooms` properties expand to one row per room. An occupancy row (% of units taken) sits under the header.
- Empty cells show that night's sell price (compact, e.g. `12tr`). Occupied nights render as one continuous bar per booking: guest name, code, status. Status uses colour **and** pattern **and** text: hold = striped + countdown ("hết hạn 14:30"), confirmed = solid, checked in = solid + icon, checked out = muted, block = grey hatched + reason.
- Click an empty cell sets check-in; click/drag/shift-click another cell sets check-out (on the same property, adjacent rooms of a `rooms` property can be selected together). A side sheet opens: **Giữ chỗ** / **Đặt luôn** / **Khoá lịch**, party, guest name + phone, source, note, live quote with nightly breakdown, adjustment, save. Click a bar → booking sheet.
- Keyboard: cells are buttons in a grid (`role="grid"`, arrow keys, Enter to select); focus visible.
- The grid scrolls inside its own container on desktop (no page overflow; responsive e2e stays green). Under 768 px: a list of properties, each with a compact month grid of nights (free/taken colours + legend) and a "Tạo booking" button.

### 5.2 Booking — `/app/bookings`

Tabs: **Hôm nay** (arrivals + departures), **Giữ chỗ** (sorted by expiry, overdue in red), **Sắp tới**, **Tất cả** (filters: property, status, source, search by code/name/phone). Table rows open the booking sheet (shared with the calendar): code + status, action buttons valid for the current status (Xác nhận, Gia hạn giữ, Nhận phòng, Trả phòng, Huỷ, Không đến), dates/units/party (editable while allowed, with re-quote), guest + link to the conversation, quote breakdown (nights, surcharges, adjustment, totals sell/cost), history.

### 5.3 Căn — `/app/properties`, `/app/properties/{id}`

Card grid: cover photo, code + name, area, sell mode, standard capacity, today's state (trống / đang ở / giữ chỗ). Editor tabs: **Thông tin** (name, code, area, address, description, amenities, layout), **Phòng** (only `rooms` mode), **Giá** (weekday table sell/cost; overrides list + "thêm ngày đặc biệt"; surcharges; child ages), **Chính sách**, **Ảnh** (captioned gallery). Save per tab; unsaved-changes guard.

### 5.4 Inbox and bot training

- Inbox sales panel (hotel): "Tạo booking" opens the booking sheet with the contact's name/phone and `contactId`/`conversationId` prefilled; the conversation's bookings are listed there.
- Bot training "Sản phẩm" becomes **Căn & phòng** for hotel bots: the list of properties with a sells/doesn't-sell switch (`lodging_bot_properties`).

## 6. Bot in part 1 (keep it working)

For hotel bots the `ai` module uses a lodging-backed `CatalogFacade` (`LODGING_CATALOG_FACADE`, implemented by the `lodging` module with the same three methods `searchBotCatalog` / `getBotProductsByIds` / `countBotCatalog`) instead of commerce products. It returns `ProductDto` rows whose `accommodation` is built from the property; `AccommodationDetails` is extended additively (`rentalType` gains `rooms`; optional `code`, `units`, `overrides`, `surcharges`; `rateBasis` is `night`). The product view keeps `catalogKind: 'accommodation'`, so the reply pipeline, tools and image allowlist stay unchanged. Images: gallery captions feed the existing image allowlist. Prompt `sales-agent@17` (hotel): prices are per night and may be quoted exactly for listed rules; still never claim a night is free or held (calendar tools come in part 3). Lodging evals are updated and run live before merge.

## 7. Migration and data

`0041_lodging.sql` (0040 is taken by `feat/pms-kiotviet`): creates the tables, RLS policies, grants and the unique/PK constraints; copies every product with `accommodation` into a `whole` property with one `whole` unit, weekday rates (owner confirmed A17's 12/13/14 tr are per night for the whole villa, cost = sell until the owner enters cost), layout, amenities, policies (empty strings stay unknown), gallery; and links it to every bot that sold the product. `stay_requests` is empty in dev; any confirmed rows are copied as confirmed bookings, other rows are not migrated (they never held dates). `docs/business/villas-a17-sample-data.json` is updated to the new shape.

## 8. Testing

- Domain: quote (weekday, overrides, min nights, surcharges, child age bands, rooms sum vs whole price, missing rate), status machine, night expansion.
- Integration (real PostgreSQL): concurrent holds on the same unit-night → one wins; whole vs room cross-block; lazy and swept hold expiry release nights; edit re-takes nights atomically; RLS cross-tenant 404; idempotent create; migration copies A17.
- Contracts: routes declared, OpenAPI parity test.
- Web: drag-select creates a hold with the right dates; Tìm trống highlights fitting rows; status shows text + pattern; booking actions follow the status; property rate validation; hotel sidebar has no "sản phẩm".
- `pnpm check` green; `ai` lodging evals live.

## 9. Out of scope (later parts)

Bot availability/quote/hold tools (part 3, next) · OTA/iCal/PMS sync · not planned: owner roles (part 2) and a money ledger (part 4) · removing the T-155 tables/routes (follow-up contract step).
