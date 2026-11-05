# Lodging: properties, calendar and bookings (T-160)

Hotel businesses sell places to stay: whole villas and per-room homestays. Rapiz is the only source of truth for their calendar: there is no sync with Google Sheets, iCal or OTAs. The backend module is `lodging` ([MODULE.md](../apps/backend/src/modules/lodging/MODULE.md)). The decision records are [ADR-018](adr/ADR-018-lodging-module.md) (module) and [ADR-019](adr/ADR-019-bot-lodging-holds.md) (bot holds); the designs are the [part 1 spec](superpowers/specs/2026-11-01-lodging-calendar-design.md) and the [part 3 spec](superpowers/specs/2026-11-01-bot-lodging-holds-design.md).

Screens (hotel businesses only; the sidebar shows **Lịch · Booking · Căn hộ** instead of products):

| Screen | Route | Purpose |
| --- | --- | --- |
| Lịch | `/app/calendar` | Nightly grid of every property and room, "Tìm trống" search, create holds, bookings and blocks |
| Booking | `/app/bookings` | Lists: Hôm nay, Giữ chỗ (with the count of bot holds waiting for staff), Sắp tới, Tất cả; filters by place, tag, source and status; the booking sheet with status actions, edits and history |
| Căn hộ | `/app/properties`, `/app/properties/$propertyId` | Property cards and the editor (Thông tin, Phòng, Giá, Chính sách, Ảnh) |
| Căn hộ & phòng (bot training) | `/app/bots/$botId/products` | Which properties the bot sells |

Vocabulary: the Vietnamese UI calls a property **Căn hộ** (sidebar, page title, "Thêm căn hộ", "Tất cả căn hộ", bot training "Căn hộ & phòng"); **Nguyên căn** stays the name of the whole-property sell mode. English says "Properties".

The Căn hộ page has two views, remembered per user in this browser (`localStorage` key `rapiz.lodging.propertiesView.<userId>`; unavailable storage falls back to cards): **Thẻ** (card grid) and **Danh sách** (a compact table: photo, code, name, area, sell mode, standard guests, T2–T5 / T6 / T7 prices from the weekday rates, today's state, and a warning icon when the bot cannot offer the place). The table scrolls horizontally inside its container on phones.

`/app/accommodations` and `/app/stays` (T-155) redirect to `/app/properties` and `/app/bookings`. For a hotel business, `/app/products` also redirects to `/app/properties`.

## Operator workflow

1. **Set up a property** (Căn hộ → new). Give a short code (e.g. `A17`), name, area and address, and choose the sell mode: **Nguyên căn** (whole) or **Theo phòng** (rooms). Enter the standard party (adults, children), an optional hard maximum, and the child age bands: children younger than `childFreeBelow` are free within the standard children; from `childAdultFrom` a child counts as an adult. Amenities, the descriptive room layout, policies (empty = unknown, never "none") and the photos and videos (tab **Ảnh & video**, see "Photos and videos" below) are optional. A whole property gets its single whole unit automatically.
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
   - **Internal property note** (Căn hộ → Thông tin, "Ghi chú nội bộ — bot không thấy", ≤ 2000 characters): shown in a card on the property name in the calendar's first column (hover, focus or click the note icon). It never reaches the bot.
   - **Quick view**: hovering or focusing a booking bar's cells shows the guest, phone, party, total, hold expiry, tags and the start of the booking note (blocks: the reason). A bar with a note shows a note icon; a bar with tags shows a tag icon with their count.
   - **Tags** (Nhãn): free-text labels on a stay (at most 8, each ≤ 30 characters; suggestions "Đã cọc", "Khách quen", "Cần xe đón", "Có trẻ nhỏ", "Đoàn công ty"). Set them when creating or editing a stay (checked-in stays too); they show as chips in the sheet and the bookings table, and the bookings list filters by one tag (clicking a chip filters too). Tags are labels only: no money logic, and changing them never re-prices the stay.
5. **Edit** a hold or confirmed stay: dates, rooms, party, guest, adjustment, note. Only a change of dates, rooms or party re-quotes the stay at today's prices; the nights are re-taken in one transaction when dates or rooms change, and a conflict keeps the old nights. Any other edit (guest, phone, note, tags, adjustment) keeps the stored quote and nights: the total is the stored price (manual or quoted) plus the new adjustment, so later price changes never move an agreed total. A stay saved with a **manual price** must get a new price (or explicitly go back to the automatic price) when its dates, rooms or party change. A checked-in stay can move its check-out, correct its price (manual price, adjustment and reason) and change its tags; a manual-priced stay that moves its check-out must again choose its price. Bookings of a paused property stay editable; new bookings are refused.
6. Every save sends the version it was edited against; a stale version answers 409 and the screen reloads.

The quote is computed in code: per night the date-range price or else the weekday price, plus surcharges above the standard party, plus a signed adjustment. Warnings: `min_nights`, `missing_rate` (staff enters the price), `over_standard`, `over_max` (staff may still save), `child_ages_missing`. A stay lasts 1–60 nights; the calendar shows up to 62 nights.

## API

All routes are authenticated, workspace-scoped and answer `404 NOT_FOUND` outside a hotel business. Contracts: `lodgingV2Routes` in `packages/contracts/src/lodging/lodging.routes.ts`. Errors: `400 VALIDATION_FAILED`, `404 NOT_FOUND`, `409 CONFLICT`; a taken night answers 409 with `details.reason = 'NIGHTS_TAKEN'` and `details.codes` (the occupying booking codes), a stale version 409 with `details.reason = 'STALE_VERSION'`, an action on a hold that has expired 409 with `details.reason = 'HOLD_EXPIRED'`. A stay without a price for every night answers 400 with `details.field = 'manualTotalSell'`.

| Route | Capability | Behaviour |
| --- | --- | --- |
| GET `/lodging/properties` | `orders.view` | Properties with units, today's state (free, partial, hold, occupied, blocked) and `weekdaySell` (whole-property sell per weekday, Monday first, from the weekday rates; a rooms property without a whole rate sums its active rooms; null = not fully priced) |
| POST `/lodging/properties` | `catalog.manage` | Create (201); added to every bot that has an explicit property list |
| GET `/lodging/properties/{id}` | `orders.view` | Detail with units, rates and surcharges |
| PATCH `/lodging/properties/{id}` | `catalog.manage` | Partial update `{version, patch}`; sell-mode change refused while a booking ends after today |
| POST `/lodging/media/videos` | `catalog.manage` | Upload one MP4 (multipart field `file`, ≤ 25 MB, ftyp-checked) → `{url: '/media/lodging/<ws>/<id>.mp4', bytes}`; 413 `VIDEO_TOO_LARGE`, 400 `INVALID_VIDEO`, 503 `MEDIA_STORAGE_UNAVAILABLE` |
| PUT `/lodging/properties/{id}/units` | `catalog.manage` | Replace the room list (rooms mode); adding or reactivating a room is refused (409) while a future whole booking exists |
| PUT `/lodging/properties/{id}/rates` | `catalog.manage` | Replace weekday rates and surcharges, validated as a whole |
| POST `/lodging/properties/{id}/overrides` | `catalog.manage` | Add a date-range price (201) |
| PATCH / DELETE `/lodging/properties/{id}/overrides/{rateId}` | `catalog.manage` | Edit / remove a date-range price (`?version=` on delete) |
| GET `/lodging/calendar?from&to&propertyIds` | `orders.view` | Rows per bookable unit with nightly prices and booking segments (with quick-view details: phone, party, total, tags, note), the property's `internalNote` and its night `notes` `{id, unitId, night, text}` in the window, 1–62 nights |
| PUT `/lodging/properties/{id}/notes` | `orders.manage` | Upsert the staff-only note of one night `{unitId (null = the property, else one of its rooms), night, text ≤ 300}`; an empty text deletes it; answers `{note}` (null when deleted) |
| POST `/lodging/availability` | `orders.view` | Free whole properties and room sets for the nights, with `fits` and quotes; fitting first, then cheapest |
| POST `/lodging/quote` | `orders.view` | Quote of one selection plus `takenBy` codes; writes nothing |
| GET `/lodging/bookings?view&propertyId&status&q&tag&source&conversationId&offset` | `orders.view` | `today` / `holds` / `upcoming` (default) / `all`, 100 per page; `tag` keeps bookings carrying that exact tag; `source` keeps one source (e.g. `bot`) |
| GET `/lodging/bookings/review-count` | `orders.view` | `{pending}`: bot holds waiting for staff (`source = bot`, status `hold`, `reviewedAt` null) |
| POST `/lodging/bookings` | `orders.manage` | Create a hold, confirmed stay or block (201); idempotent by `clientRequestId`; stays accept `tags` (≤ 8, each ≤ 30 chars; trimmed, duplicates dropped) |
| GET `/lodging/bookings/{id}` | `orders.view` | Detail with history; `reviewedAt` is the first staff action on a bot booking |
| PATCH `/lodging/bookings/{id}` | `orders.manage` | Edit; re-quotes only when dates, units or party change, re-takes the nights atomically when dates or units change |
| POST `/lodging/bookings/{id}/status` | `orders.manage` | `confirm`, `check_in`, `check_out`, `cancel`, `no_show`, `extend_hold`, `remove_block` |
| GET / PATCH `/lodging/settings` | `orders.view` / `catalog.manage` | Hold minutes |
| GET / PUT `/lodging/bots/{botId}/properties` | `orders.view` / `bots.manage` | The properties a bot sells (`[]` = every property) |

**Pictures.** Photos uploaded to Rapiz storage (`POST /products/images`, shared with commerce) are stored and returned as host-relative paths `/media/products/<workspaceId>/<file>.jpg|png`, so the browser loads them from whatever host serves the app and a new public host (dev tunnel restart, domain move) never breaks them. Rows written before this rule hold the absolute URL of the public host of that time; every read (web DTOs and the bot) normalises a Rapiz URL on any host to its path, and a write stores the path. When the bot sends a photo (Messenger, Zalo, website widget), the path is turned into an absolute URL on the **current** `S3_PUBLIC_URL` (`https://<public host>/media`), so that variable must point at the live public host. Only the exact key shapes Rapiz generates count as its media (uuid workspace and file names: `products/<ws>/<id>.jpg|png`, `workspaces/<ws>/bots/<bot>/<id>.jpg|png|webp`, `webchat/<ws>/<connection>/<id>.jpg|png|webp|gif`, `lodging/<ws>/<id>.mp4`); a look-alike external link such as `https://cdn.example.vn/media/products/villa-1.jpg` is kept as it is. A gallery photo that is Rapiz media must be this business's product picture (`/media/products/<workspaceId>/…`), else 400 `VALIDATION_FAILED` with `details = {reason: 'IMAGE_NOT_UPLOADED', field: 'gallery[f].items[i].url'}`; external https links stay allowed. An uploaded video must be this business's (`/media/lodging/<workspaceId>/…`), else 400 `VIDEO_NOT_UPLOADED`; links are never Rapiz media. Helpers: `apps/backend/src/common/storage/media-url.ts`.

**Photos and videos (T-192, [ADR-026](adr/ADR-026-lodging-media-folders.md)).** The **Ảnh & video** tab keeps a property's media in folders, like Google Drive: up to 20 folders (unique names, case-insensitive), 200 items in all, each a photo (uploaded through `POST /products/images` and stored as JPEG/PNG; a picked WebP is converted to JPEG), an MP4 video uploaded through `POST /lodging/media/videos` (≤ 25 MB; the API buffers the whole file in memory before storing it) or an https video link (YouTube, Drive, TikTok…) with an optional title. Captions are optional: the folder name describes a photo without one. Inside a folder every photo is numbered; photos 1–8 are marked "Bot gửi trước" because the bot sends a folder 8 photos at a time in this order and offers the rest. Tiles reorder by drag and drop (keyboard too) or the ⋮ menu (Lên / Xuống / Chuyển sang thư mục… / Đặt làm ảnh bìa / Sửa chú thích / Xoá), and several can be selected to move or remove. The cover (`galleryCover`) is the chosen photo, or the first photo of the first folder that has one (contracts `galleryCoverUrl`; the lists and the bot use it). The open folder is in the URL (`?folder=<id>`). Saving sends the whole `gallery` and `galleryCover` in one `PATCH`. Removing an item never deletes the stored file. Migration 0066 put every existing flat gallery into one folder "Ảnh chung". The website widget still shows only the first picture of a bot message and no video.

Booking events go to the outbox: `lodging.booking.created.v1` and `lodging.booking.{confirmed,cancelled,expired,checked_in,checked_out}.v1`. They carry ids, codes, dates, status and source, never the guest's name or phone.

## What the bot does (parts 1 and 3)

**Catalog (part 1).** Hotel bots read the properties they sell from the lodging module, through `LODGING_CATALOG_FACADE` (the same shape as the commerce catalog). A property appears only when it is active and every weekday is priced. The bot sees sell prices only (weekday rates, upcoming date-range prices, surcharges, child age bands, room prices of a rooms property), the policies, amenities, layout, its media folders (`accommodation.albums`, with album and video ids for `send_message`) and their photos flattened (`gallery`). It never sees a cost, the internal property note, night notes or booking tags.

**Calendar, quotes and holds (part 3, T-161, [ADR-019](adr/ADR-019-bot-lodging-holds.md)).** The bot reads the calendar through `LODGING_BOT_FACADE` and never computes dates, weekdays, totals or availability itself (prompt `sales-agent@18`, `@20` since T-192 with the media-folder rules; tools in [the AI engine doc](06-ai-engine.md) §3.5 "Lodging holds"):

1. **Check.** For any dated question the bot calls `check_availability` with check-in, check-out, adults, children's ages and optionally a property code; it asks for whatever is missing first. The server answers the free options of the properties the bot sells (at most 5, fitting parties first, then cheapest) with nightly sell prices, Vietnamese weekday labels, surcharges and the total. When the asked place is full it says so (`requestedFull`) and the bot offers the other options. A place whose date-range price needs a longer stay comes back with its `minNights`. Past dates, stays over 60 nights and invalid parties come back as problems for the bot to explain. An option above the property's maximum party is not `fits` and never `overStandard`, so the bot does not offer it.
2. **Prepare.** When the customer wants to keep a place, the bot asks for a name and phone and calls `prepare_hold`. Nothing is written to the calendar yet: the server checks everything again, stores one draft per conversation (30 minutes, a new prepare replaces it), and sends its own summary (place, dates with weekdays, nights, party, total, guest, hold time) with the quick replies **✅ Giữ chỗ** and **✏️ Sửa thông tin**.
3. **Confirm.** When the customer answers after the summary, `confirm_hold` re-quotes and creates a booking with status **Giữ chỗ**, source **Bot**, the contact link, the conversation link (messaging channels only, not the test chat) and the business's hold time, through the same booking path as staff. The bot gives the code and the expiry ("đã giữ chỗ …"); it never says the stay is booked or confirmed. If the nights were taken meanwhile, the price changed or the draft expired, the bot apologises and offers alternatives (none when the check-in day has already passed). A retried confirm returns the same booking while it is still on hold. A draft and its confirmed copy are deleted once their 30 minutes are over.
4. **Staff review.** A bot hold waits for staff until someone acts on it (any status action or edit). The Booking page marks bot bookings **Bot tạo** (amber while waiting), shows the waiting count on the **Giữ chỗ** tab and next to **Booking** in the sidebar (refreshed every minute and after every booking change), and filters by **Nguồn → Bot**. The booking sheet of a waiting bot hold says "Bot đã giữ chỗ theo yêu cầu khách — gọi xác nhận rồi bấm Xác nhận" next to **Mở hội thoại**: read the chat, call the guest, then **Xác nhận**, **Gia hạn giữ** or **Huỷ**. An untouched hold expires like any other.

`prepare_hold`, `confirm_hold` and `cancel_hold_draft` need the bot's **Chốt đơn** switch; without it the bot only checks availability. Hotel bots have no retail order tools.

Holds placed from the bot's test chat (playground) are real holds: they block the nights and count in the waiting badge. Cancel them in **Booking** after testing.

## Not done yet

Not planned: per-property owner accounts and a money ledger (deposits, payouts, commission) — decided 2026-11-01 as outside an AI sales agent.

- Staff notifications for new bot holds.
- The analytics conversion event `booking_confirmed` (deferred; the outbox already carries `lodging.booking.confirmed.v1`).
- A periodic hold sweeper (needs worker job processors), OTA/iCal sync.
- Removing the T-155 routes and tables (contract step).

## Legacy T-155

The T-155 slice ([ADR-013](adr/ADR-013-lodging-catalog-and-stay-requests.md), superseded in part) stored a villa as a commerce product with `products.accommodation` and kept staff-confirmed `stay_requests` (`/stay-requests…` routes). Migration 0041 copied every accommodation product into a whole property (A17 keeps code `A17`, weekday rates 12/13/14 million VND per night with cost = sell) and every confirmed stay request into a confirmed booking. The routes and tables are still served but unused by the UI, and are removed in a later contract step.

See the [A17 sample](business/villas-a17-sample-data.json) and [A17 acceptance](business/villas-a17-acceptance.md).
