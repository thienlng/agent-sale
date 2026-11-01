# Lodging: properties, calendar and bookings (T-160)

Hotel businesses sell places to stay: whole villas and per-room homestays. Rapiz is the only source of truth for their calendar: there is no sync with Google Sheets, iCal or OTAs. The backend module is `lodging` ([MODULE.md](../apps/backend/src/modules/lodging/MODULE.md)). The decision record is [ADR-018](adr/ADR-018-lodging-module.md), and the design is in the [part 1 spec](superpowers/specs/2026-11-01-lodging-calendar-design.md).

Screens (hotel businesses only; the sidebar shows **Lịch · Booking · Căn** instead of products):

| Screen | Route | Purpose |
| --- | --- | --- |
| Lịch | `/app/calendar` | Nightly grid of every property and room, "Tìm trống" search, create holds, bookings and blocks |
| Booking | `/app/bookings` | Lists: Hôm nay, Giữ chỗ, Sắp tới, Tất cả; the booking sheet with status actions, edits and history |
| Căn | `/app/properties`, `/app/properties/$propertyId` | Property cards and the editor (Thông tin, Phòng, Giá, Chính sách, Ảnh) |
| Căn & phòng (bot training) | `/app/bots/$botId/products` | Which properties the bot sells |

`/app/accommodations` and `/app/stays` (T-155) redirect to `/app/properties` and `/app/bookings`. For a hotel business, `/app/products` also redirects to `/app/properties`.

## Operator workflow

1. **Set up a property** (Căn → new). Give a short code (e.g. `A17`), name, area and address, and choose the sell mode: **Nguyên căn** (whole) or **Theo phòng** (rooms). Enter the standard party (adults, children), an optional hard maximum, and the child age bands: children younger than `childFreeBelow` are free within the standard children; from `childAdultFrom` a child counts as an adult. Amenities, the descriptive room layout, policies (empty = unknown, never "none") and a captioned gallery (https links, up to 30) are optional. A whole property gets its single whole unit automatically.
2. **Rooms** (rooms mode only, tab Phòng): add rooms with beds and capacity. A room that has bookings cannot be deleted; deactivate it instead. A room cannot be added or reactivated while a whole-property booking holds a later night (409 with `details.codes`): that booking took the rooms of its day, so move or cancel it first. The sell mode can change only while the property has no booking ending after today.
3. **Prices** (tab Giá): weekday prices must cover all seven weekdays exactly once for every target: the whole property, or each active room of a rooms property. A rooms property may also have whole-property prices; without them a whole rental costs the sum of its rooms. Add date-range prices ("ngày đặc biệt": Tết, holidays, peak) with an optional minimum stay; ranges of one target never overlap, and a range price wins over the weekday price. Surcharges per extra adult and extra child are per person per night. Every price has a sell and a cost price.
4. **Calendar** (Lịch):
   - **Find availability**: enter check-in, check-out, adults and child ages. Properties that fit are highlighted with their total and a **Giữ chỗ** button; full ones are dimmed. A rooms property offers the whole place and, when it differs, a set of free rooms.
   - **Hold**: select free nights (click, drag or shift-click) and save as **Giữ chỗ**. A hold takes the nights and expires after the business's hold time (default 120 minutes, setting 15–1440). Expiry is lazy: the next lodging read or write of the business marks it `expired` and frees the nights. Staff can extend a hold.
   - **Confirm** (Đặt luôn, or Xác nhận on a hold): the stay is booked.
   - **Check in** from the check-in date (Asia/Ho_Chi_Minh), **check out** afterwards. **Không đến** (no-show) and **Huỷ** (cancel, with a reason) free the nights.
   - **Early check-out**: checking out before the booked check-out moves it to the later of check-in + 1 night and today; the later nights go back to the calendar. An automatic price is re-quoted for the shorter stay (kept as it was when a night has no price); a manual price is kept. The history records the old and new check-out.
   - A hold that expired before a status action answers 409 with `details.reason = 'HOLD_EXPIRED'` ("Giữ chỗ đã hết hạn").
   - **Block** (Khoá lịch): takes nights without a guest or money, e.g. repairs or owner use. Removing the block frees them.
   - **Night notes** (tab **Ghi chú** of the create sheet): a staff-only text (≤ 300 characters) on each selected night of the property, or of each selected room. The same text is saved on every night of the range; an empty text (**Xoá ghi chú**) deletes it. A cell with a note shows a small dot, its accessible name ends with the note, and hovering or focusing it shows the note.
   - **Internal property note** (Căn → Thông tin, "Ghi chú nội bộ — bot không thấy", ≤ 2000 characters): shown in a card on the property name in the calendar's first column (hover, focus or click the note icon). It never reaches the bot.
   - **Quick view**: hovering or focusing a booking bar's cells shows the guest, phone, party, total, hold expiry, tags and the start of the booking note (blocks: the reason). A bar with a note shows a note icon; a bar with tags shows a tag icon with their count.
   - **Tags** (Nhãn): free-text labels on a stay (at most 8, each ≤ 30 characters; suggestions "Đã cọc", "Khách quen", "Cần xe đón", "Có trẻ nhỏ", "Đoàn công ty"). Set them when creating or editing a stay (checked-in stays too); they show as chips in the sheet and the bookings table, and the bookings list filters by one tag (clicking a chip filters too). Tags are labels only: no money logic, and changing them never re-prices the stay.
5. **Edit** a hold or confirmed stay: dates, rooms, party, guest, adjustment, note. Only a change of dates, rooms or party re-quotes the stay at today's prices; the nights are re-taken in one transaction when dates or rooms change, and a conflict keeps the old nights. Any other edit (guest, phone, note, tags, adjustment) keeps the stored quote and nights: the total is the stored price (manual or quoted) plus the new adjustment, so later price changes never move an agreed total. A stay saved with a **manual price** must get a new price (or explicitly go back to the automatic price) when its dates, rooms or party change. A checked-in stay can move its check-out, correct its price (manual price, adjustment and reason) and change its tags; a manual-priced stay that moves its check-out must again choose its price. Bookings of a paused property stay editable; new bookings are refused.
6. Every save sends the version it was edited against; a stale version answers 409 and the screen reloads.

The quote is computed in code: per night the date-range price or else the weekday price, plus surcharges above the standard party, plus a signed adjustment. Warnings: `min_nights`, `missing_rate` (staff enters the price), `over_standard`, `over_max` (staff may still save), `child_ages_missing`. A stay lasts 1–60 nights; the calendar shows up to 62 nights.

## API

All routes are authenticated, workspace-scoped and answer `404 NOT_FOUND` outside a hotel business. Contracts: `lodgingV2Routes` in `packages/contracts/src/lodging/lodging.routes.ts`. Errors: `400 VALIDATION_FAILED`, `404 NOT_FOUND`, `409 CONFLICT`; a taken night answers 409 with `details.reason = 'NIGHTS_TAKEN'` and `details.codes` (the occupying booking codes), a stale version 409 with `details.reason = 'STALE_VERSION'`, an action on a hold that has expired 409 with `details.reason = 'HOLD_EXPIRED'`. A stay without a price for every night answers 400 with `details.field = 'manualTotalSell'`.

| Route | Capability | Behaviour |
| --- | --- | --- |
| GET `/lodging/properties` | `orders.view` | Properties with units and today's state (free, partial, hold, occupied, blocked) |
| POST `/lodging/properties` | `catalog.manage` | Create (201); added to every bot that has an explicit property list |
| GET `/lodging/properties/{id}` | `orders.view` | Detail with units, rates and surcharges |
| PATCH `/lodging/properties/{id}` | `catalog.manage` | Partial update `{version, patch}`; sell-mode change refused while a booking ends after today |
| PUT `/lodging/properties/{id}/units` | `catalog.manage` | Replace the room list (rooms mode); adding or reactivating a room is refused (409) while a future whole booking exists |
| PUT `/lodging/properties/{id}/rates` | `catalog.manage` | Replace weekday rates and surcharges, validated as a whole |
| POST `/lodging/properties/{id}/overrides` | `catalog.manage` | Add a date-range price (201) |
| PATCH / DELETE `/lodging/properties/{id}/overrides/{rateId}` | `catalog.manage` | Edit / remove a date-range price (`?version=` on delete) |
| GET `/lodging/calendar?from&to&propertyIds` | `orders.view` | Rows per bookable unit with nightly prices and booking segments (with quick-view details: phone, party, total, tags, note), the property's `internalNote` and its night `notes` `{id, unitId, night, text}` in the window, 1–62 nights |
| PUT `/lodging/properties/{id}/notes` | `orders.manage` | Upsert the staff-only note of one night `{unitId (null = the property, else one of its rooms), night, text ≤ 300}`; an empty text deletes it; answers `{note}` (null when deleted) |
| POST `/lodging/availability` | `orders.view` | Free whole properties and room sets for the nights, with `fits` and quotes; fitting first, then cheapest |
| POST `/lodging/quote` | `orders.view` | Quote of one selection plus `takenBy` codes; writes nothing |
| GET `/lodging/bookings?view&propertyId&status&q&tag&conversationId&offset` | `orders.view` | `today` / `holds` / `upcoming` (default) / `all`, 100 per page; `tag` keeps bookings carrying that exact tag |
| POST `/lodging/bookings` | `orders.manage` | Create a hold, confirmed stay or block (201); idempotent by `clientRequestId`; stays accept `tags` (≤ 8, each ≤ 30 chars; trimmed, duplicates dropped) |
| GET `/lodging/bookings/{id}` | `orders.view` | Detail with history |
| PATCH `/lodging/bookings/{id}` | `orders.manage` | Edit; re-quotes only when dates, units or party change, re-takes the nights atomically when dates or units change |
| POST `/lodging/bookings/{id}/status` | `orders.manage` | `confirm`, `check_in`, `check_out`, `cancel`, `no_show`, `extend_hold`, `remove_block` |
| GET / PATCH `/lodging/settings` | `orders.view` / `catalog.manage` | Hold minutes |
| GET / PUT `/lodging/bots/{botId}/properties` | `orders.view` / `bots.manage` | The properties a bot sells (`[]` = every property) |

Booking events go to the outbox: `lodging.booking.created.v1` and `lodging.booking.{confirmed,cancelled,expired,checked_in,checked_out}.v1`. They carry ids, codes, dates, status and source, never the guest's name or phone.

## What the bot does in part 1

Hotel bots read the properties they sell from the lodging module, through `LODGING_CATALOG_FACADE` (the same shape as the commerce catalog). A property appears only when it is active and every weekday is priced. The bot sees sell prices only (weekday rates, upcoming date-range prices, surcharges, child age bands, room prices of a rooms property), the policies, amenities, layout and captioned gallery. Prompt `sales-agent@17` lets it quote nightly prices exactly; a stay total comes only from the `calculate` tool, never from the model's own arithmetic. It must never say a night is free, held or booked, because it cannot read the calendar yet. Hotel bots have no order tools.

## Not done yet

Not planned: per-property owner accounts and a money ledger (deposits, payouts, commission) — decided 2026-11-01 as outside an AI sales agent.


- Bot tools to check availability, quote and place holds (part 3).
- The analytics conversion event `booking_confirmed` (deferred; the outbox already carries `lodging.booking.confirmed.v1`).
- A periodic hold sweeper (needs worker job processors), OTA/iCal sync.
- Removing the T-155 routes and tables (contract step).

## Legacy T-155

The T-155 slice ([ADR-013](adr/ADR-013-lodging-catalog-and-stay-requests.md), superseded in part) stored a villa as a commerce product with `products.accommodation` and kept staff-confirmed `stay_requests` (`/stay-requests…` routes). Migration 0041 copied every accommodation product into a whole property (A17 keeps code `A17`, weekday rates 12/13/14 million VND per night with cost = sell) and every confirmed stay request into a confirmed booking. The routes and tables are still served but unused by the UI, and are removed in a later contract step.

See the [A17 sample](business/villas-a17-sample-data.json) and [A17 acceptance](business/villas-a17-acceptance.md).
