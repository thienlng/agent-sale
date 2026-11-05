# Lodging units with their own details, and bedroom packages (T-193)

Status: approved by the owner in chat, 2026-11-05. Builds on T-160 (lodging calendar), T-161 (bot holds) and T-192 (media folders).

## Problem

1. **Bedroom packages.** Some villas are always rented whole, to one party, but the owner opens only part of the bedrooms and prices by how many are open. Example from the owner's sheet, "Aura Villa 6PN":

   | | Mon–Thu | Fri | Sat | Sun |
   | --- | --- | --- | --- | --- |
   | 6PN | 10.000 | 12.000 | 18.000 | 12.000 |
   | 5PN | 9.000 | 11.000 | 16.000 | 11.000 |
   | 4PN | 8.000 | 10.000 | not sold | 10.000 |

   A night is taken by one booking whatever the package (red cells in the sheet). The closed bedrooms are never sold to someone else. Today a whole property has one price per weekday and one standard party, so this cannot be entered.

2. **Units with their own details.** One place can hold a main house and many bungalows around it. Each bungalow has its own price, its own view and its own photos. Today a room of a rooms property has only a name, beds and a capacity; it cannot be described, it has no photos, and the bot cannot tell one bungalow from another. Each bungalow is entered by hand; there are no "types × quantity" (decided: not needed, no duplicate button either).

## Decisions

- The **property** (Căn hộ) stays the place: address, policies, shared amenities, the place's photos, the bot's listing.
- A **unit** (Đơn vị cho thuê: room, bungalow, house) gets its own details: category, view, area, description, amenities, a standard and a maximum party, and its own media folders. Prices per unit already exist and stay.
- A **package** (Gói phòng) is a priced variant of one rental target: the whole property, or one unit. It has a name, a bedroom count and its own standard and maximum party. Weekday and date-range prices can belong to a package. Occupancy does not change: a booking still takes the nights of its units, so packages never allow double booking.
- A target without packages works exactly as today. Existing data needs no backfill to keep working.
- Surcharges per extra person stay on the property (one shared level). Ruling: per-unit surcharges make a multi-unit quote ambiguous (which unit's extra guest?) for little value; adding them later is a column, not a redesign.

## Data model (migration 0067, expand-only)

`lodging_units` gains:

| Column | Type | Notes |
| --- | --- | --- |
| `category` | text not null default `'room'` | `room`, `bungalow`, `house`, `other`; ignored for the `whole` unit |
| `view` | text not null default `''` | ≤ 200, e.g. "View đồi thông" |
| `area_m2` | integer null | 1–100000 |
| `description` | text not null default `''` | ≤ 2000 |
| `amenities` | jsonb not null default `[]` | ≤ 40 strings, each ≤ 200 |
| `max_guests` | integer null | 1–2000; null = no hard maximum for this unit |
| `gallery` | jsonb not null default `[]` | the T-192 `Gallery` shape (folders of image / video / link items) |
| `gallery_cover` | text not null default `''` | same rule as the property's `galleryCover` |

`capacity_adults` / `capacity_children` keep their meaning (the unit's standard party, used by the quote); the UI now calls them "Khách tiêu chuẩn".

New table `lodging_packages`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `workspace_id` | uuid not null | tenant |
| `property_id` | uuid not null | FK → properties, cascade |
| `unit_id` | uuid null | FK → units, cascade; **null = the whole property** (same convention as `lodging_rates.unit_id`) |
| `name` | text not null | 1–50, e.g. "4PN"; unique per (property, target), case-insensitive |
| `bedrooms` | integer not null | 1–100 |
| `standard_adults` | integer not null | 1–1000 |
| `standard_children` | integer not null default 0 | 0–1000 |
| `max_guests` | integer null | 1–2000 |
| `sort_order` | integer not null default 0 | |

`lodging_rates` gains `package_id uuid null` (FK → packages, cascade). `lodging_booking_units` gains `package_id uuid null` (FK → packages, set null). A whole booking of a whole-mode property already has one booking-unit row (the whole unit); its package is stored there. A whole rental of a rooms property stores a whole-target package on every row (same id), so the booking's package is read from any row.

Rollback: `packages/db/sql/rollback-0067-lodging-units-packages.sql` drops the new table and columns; the runbook gets the same section as 0066.

## Contracts

- `UnitInput` / `UnitDto` gain `category`, `view`, `areaM2`, `description`, `amenities`, `maxGuests`, `gallery`, `galleryCover` (all with defaults on input). The cover rule and the `IMAGE_NOT_UPLOADED` / `VIDEO_NOT_UPLOADED` media checks of the property gallery apply to every unit gallery (error `field` = `units[u].gallery[f].items[i].url`). Limits per unit: 20 folders, 200 items (same as a property).
- `PackageDto {id, unitId|null, name, bedrooms, standardAdults, standardChildren, maxGuests|null, sortOrder}`; `PropertyDto.packages: PackageDto[]`.
- `PutRatesRequest` gains `packages: PackageInput[]` (default `[]`; `id` optional for new ones; a new package is referenced by its rates through a client key `key`, see below). Rates and packages are replaced together and validated as a whole, because a rate can point at a package created in the same request:
  - `PackageInput {id?, key, unitId|null, name, bedrooms, standardAdults, standardChildren?, maxGuests?}` where `key` is a client string (≤ 40) unique in the request; `WeekdayRate` and the override inputs gain `packageKey: string | null` (default null). The server maps keys to ids (existing id when `id` is given, else a new uuid).
  - Overrides keep their own routes; their inputs gain `packageId: uuid | null` (default null).
- `RateDto` gains `packageId`. `StaySelection` gains `packageIds: uuid[]` (default `[]`). `QuoteDto` gains `packages: {target: uuid|null, packageId, name}[]` (the packages the quote used) and the warning `package_unavailable`. Booking DTOs, the calendar segments and the availability options carry the package name(s).

## Rate validation (domain `rates.ts`)

For each rental target (whole property, or each active unit):

- **No packages:** unchanged (weekdays 1–7 priced exactly once by rates with `package_id` null).
- **With packages:** every rate of that target must name one of its packages (a rate with `package_id` null on such a target is refused). The **full package** (most bedrooms; ties → the later `sort_order`) prices every weekday exactly once. Every other package prices each weekday **at most** once; a weekday it does not price is "not sold" that day.
- Overrides never overlap per (target, package). An override of a package may also cover a weekday that package does not sell: the override wins for its dates.
- A package's target must exist and be active (whole-property packages only on a property whose whole rental is offered). At most 10 packages per target. Bedrooms strictly differ between packages of one target.

## Quote (domain `quote.ts`)

- Each priced target of the selection gets a package when it has packages: the one in `packageIds` for that target, else **auto**: the package with the fewest bedrooms whose own maximum (or, when it has none, its standard party) holds the party and that prices every night of the stay; when none holds the party, the full package. Auto only looks at the party when the selection has a single target with packages; otherwise it picks the full package for each target.
- A package chosen explicitly that does not price a night → that night is `missing_rate` and the warning `package_unavailable` is added (staff may enter a manual price as today).
- The night price of a target with a package is `priceNight(rules, target, night, packageId)`.
- The standard party of a whole rental with a package is the package's standard; of a single unit with a package, the package's standard; otherwise as today (units' capacities, or the property's standard for a whole rental). `over_max` uses the package's `maxGuests` when the selection is one package target, else the selected units' `maxGuests` sum when every selected unit has one, and the property's `maxGuests` always.
- The quote lists the packages it used.

## Availability, calendar and bookings

- `freeOptions` keeps its selections; each option's quote auto-picks packages. An option on a single package target also returns `alternatives: {packageId, name, bedrooms, totalSell|null, fits}[]` for the target's other packages, so staff and the bot can offer a bigger package.
- Booking create/edit accept `packageIds`; changing the package re-quotes like a change of rooms. The calendar bar and the quick view show the package name ("Nguyên căn · 5PN").
- Event payloads are unchanged.

## Bot

- Catalog (`accommodation`): each unit carries `category`, `view`, `areaM2`, `description`, `amenities`, `maxGuests`, its own `albums` (same shape as the property's, ids usable in `send_message albumId` / `videoId`), and its weekday sell prices per package; a target with packages lists `packages: {name, bedrooms, standard, max, weekdaySell: (number|null)[7]}` (null = not sold that weekday). Sell prices only, never cost.
- `send_message` resolves `albumId` / `videoId` across the property's and its units' folders (ids are uuids, unique).
- `check_availability` options carry the auto package name and `alternatives` with their totals.
- `prepare_hold` gains `packages?: {room?: string, package: string}[]` (room omitted = the whole property); unknown names come back as a problem listing the valid ones. The hold summary names the package.
- Prompt `sales-agent@21`: present units by their view and description; when a villa has packages, quote the package that fits the party, and say a bigger one exists with its price when asked or when it is cheap to mention; send a unit's own album when the customer asks about that unit. Evals cover: package auto-pick, "not sold that day" upgrade, unit album choice.

## Web

- **Rooms tab → "Đơn vị cho thuê"** (rooms mode): a list of unit cards (cover, name, category, view, standard/max party, "từ" lowest weekday sell). The add / reorder / deactivate actions stay. Clicking a card opens the **unit page** `/app/properties/$propertyId/units/$unitId` (lazy route) with tabs **Thông tin** (name, category, view, area, beds, standard adults/children, max, description, amenities, active), **Giá** (that unit's rows of the rates matrix, with its packages) and **Ảnh & video** (the T-192 folder UI on the unit's gallery). Saving Thông tin / Ảnh sends the full unit list (`PUT units`); saving Giá sends the full rates + packages (`PUT rates`), keeping other targets as loaded.
- **Giá tab** (property): a target with packages shows one row pair (sell / cost) per package, labelled with the package name, ordered by bedrooms descending; an empty cell of a non-full package means "not sold" and shows a dash placeholder "Không bán". A "Gói phòng" section above the matrix adds, edits (name, bedrooms, standard adults/children, max) and removes packages of the whole property (whole mode) — on the unit page, of that unit. Date-range prices get a package select when the target has packages.
- **Booking forms / Tìm trống**: a package select per target with packages (default: the quote's auto pick); the quote breakdown names it; Tìm trống shows the package name and the alternatives' totals.
- Vietnamese strings in `packages/i18n` (vi + en). Layout verified with screenshots at 1440 px and 390 px. The initial bundle stays under the 250 KB budget (the unit page is a lazy route).

## Docs

`docs/lodging.md` (operator workflow, API table, bot section), `docs/06-ai-engine.md` §3.5, the ERD/data docs that list lodging tables, ADR-027 (packages and unit details: why packages are price variants of a target instead of separate units sharing a calendar), runbook rollback section.

## Out of scope

Room types with a quantity and automatic room assignment; per-unit surcharges; per-unit policies; selling a unit's packages to different parties on the same night; OTA sync.
