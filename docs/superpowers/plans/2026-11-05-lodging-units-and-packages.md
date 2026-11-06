# Lodging Units and Bedroom Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every lodging unit (room, bungalow, house) its own details and media folders, and let any rental target (the whole property or one unit) carry bedroom packages (4PN / 5PN / 6PN) with their own prices, party and "not sold" weekdays — in the backend, the bot and the web editor.

**Architecture:** Expand-only migration 0067 adds unit detail columns, a `lodging_packages` table, and `package_id` on rates and booking units. Domain `rates.ts` / `quote.ts` learn packages (coverage rules, auto-pick, `package_unavailable`). Services read/write packages through `PUT /rates` (packages + rates together), bookings accept `packageIds`, availability adds `alternatives`. The bot catalog exposes unit details, unit albums and packages; `prepare_hold` takes package names; prompt `sales-agent@21`. The web rooms tab becomes unit cards opening a lazy unit page (Thông tin / Giá / Ảnh & video).

**Tech Stack:** TypeScript, Zod 4 (`packages/contracts`), Drizzle + hand-written SQL migrations (`packages/db`), NestJS on Fastify, Vitest + Testcontainers, React 19 + TanStack Router/Query + shadcn/ui + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-lodging-units-and-packages-design.md` (read it fully before starting any task — it is binding; this plan only orders the work).

## Global Constraints

- English for code, identifiers, comments, commits, tests and technical docs; Vietnamese only in i18n `vi` strings and model-facing Vietnamese labels that follow existing patterns.
- `pnpm check` (lint + arch + typecheck + test + build) must pass at the end. Never skip, delete or weaken a test or a lint rule. Untracked `.playwright-mcp/*.js` files belong to the owner: never delete them; lint failures caused only by them are expected locally.
- Module boundaries: `lodging` never imports another tier-2 module; `ai` never imports `conversation`; web features never import each other — compose in `routes/`.
- Migrations are forward-only; the new file is `packages/db/migrations/0067_lodging_units_packages.sql`; rollback SQL in `packages/db/sql/rollback-0067-lodging-units-packages.sql`.
- Conventional Commits; allowed scopes include `api` (contracts), `db`, `backend`, `ai`, `web`, `i18n`, `docs` (NOT `lodging`/`contracts`). Header ≤ 100 chars, body lines ≤ 100 chars. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `packages/contracts`, `packages/db`, `packages/i18n` are consumed through `dist/`: rebuild with `pnpm --filter @agent-sales/{contracts,db,i18n} build` after changing them.
- Backward compatibility: a target without packages and a unit without the new fields behave exactly as before; every existing test keeps passing unchanged unless the spec changes the behaviour it asserts.
- Limits (exact): package name 1–50 chars, unique per target case-insensitive; bedrooms 1–100, strictly different within a target; ≤ 10 packages per target; unit `view` ≤ 200; `description` ≤ 2000; `amenities` ≤ 40 × ≤ 200; `areaM2` 1–100000 or null; unit `maxGuests` 1–2000 or null; unit gallery 20 folders / 200 items (T-192 limits); package `key` ≤ 40 chars.
- Initial web bundle ≤ 250 KB gzip (currently 247.7 KB): the unit page must be a lazy route; check `pnpm --filter web build` output.
- UI verified by screenshots at 1440 px and 390 px; rows and columns must line up.

---

### Task 1: Contracts + DB migration 0067

**Files:** `packages/contracts/src/lodging/lodging.schema.ts` (+ test), `packages/contracts/src/lodging/lodging.routes.ts` (descriptions only if needed), `packages/db/src/schema/lodging.ts`, `packages/db/migrations/0067_lodging_units_packages.sql`, `packages/db/sql/rollback-0067-lodging-units-packages.sql`, an integration test next to `packages/db/src/lodging-media-folders.integration.test.ts`.

**Produces:**
- `UnitCategory = z.enum(['room','bungalow','house','other'])`; `UnitInput` / `UnitDto` gain `category` (default `'room'`), `view` (default ''), `areaM2` (nullable, default null), `description` (default ''), `amenities` (default []), `maxGuests` (nullable, default null), `gallery` (`Gallery`, default []), `galleryCover` (default ''); `UnitInput` refines the cover like `PropertyInput` (`hasGalleryImage`).
- `PackageInput {id?: uuid, key: string(1..40), unitId: uuid|null, name: string(1..50 trimmed), bedrooms: int 1..100, standardAdults: int 1..1000, standardChildren: int 0..1000 default 0, maxGuests: int 1..2000 nullable default null}`; `PackageDto {id, unitId|null, name, bedrooms, standardAdults, standardChildren, maxGuests|null, sortOrder}`.
- `WeekdayRate.packageKey: string|null` default null; `PutRatesRequest.packages: PackageInput[]` max 200 default []; `overrideShape.packageId: uuid|null` (create default null); `RateDto.packageId: uuid|null`; `PropertyDto.packages: PackageDto[]`.
- `StaySelection.packageIds: uuid[]` max 100 default []; `QuoteWarning` gains `'package_unavailable'`; `QuoteDto.packages: {target: uuid|null, packageId: uuid, name: string}[]`.
- Availability option DTO gains `packages` (same shape as the quote's) and `alternatives: {packageId, name, bedrooms, totalSell: Vnd|null, fits: boolean}[]`. Booking DTO(s) and calendar segment DTO gain `packageNames: string[]` (empty when none) and the booking DTO `packageIds: uuid[]`. Find the existing availability / booking / calendar DTOs in `lodging.schema.ts` and extend them.
- DB: columns and table exactly as the spec's "Data model" section (FKs with the stated `on delete`; index `lodging_packages(property_id)`; unique index `(property_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'), lower(name))`; check constraints for the ranges). Drizzle schema mirrors it (`lodgingPackages`, new columns on `lodgingUnits`, `packageId` on `lodgingRates` and `lodgingBookingUnits`).
- Rollback SQL drops `lodging_rates.package_id`, `lodging_booking_units.package_id`, the table, then the unit columns.

- [ ] Write contract tests (parse defaults; cover refinement on a unit; package key/name limits; `packageIds` default) → fail → implement → pass.
- [ ] Write the migration + Drizzle schema; integration test (Testcontainers, same style as the 0066 test): migrate, insert a package and a rate with `package_id`, assert cascade on unit delete and uniqueness of the name per target; run the rollback SQL and assert the columns are gone.
- [ ] Build contracts + db; run `pnpm --filter @agent-sales/contracts test` and the db integration test.
- [ ] Commit (`feat(api): …` and `feat(db): …`, two commits).

Expected fallout: backend and web typecheck may fail where DTOs are now missing fields (`packages`, `packageIds`, unit fields). Do NOT fix those files here; Tasks 3–7 do.

### Task 2: Domain — rates coverage and quote with packages

**Files:** `apps/backend/src/modules/lodging/domain/rates.ts` (+ spec), `domain/quote.ts` (+ spec).

**Consumes:** nothing from Task 1 at runtime (domain types are local).

**Produces:**
- `RateRule.packageId: string | null`.
- `DomainPackage {id, unitId: string|null, name, bedrooms, standardAdults, standardChildren, maxGuests: number|null, sortOrder}`.
- `fullPackage(packages: DomainPackage[], target: string|null): DomainPackage | undefined` — most bedrooms, ties → higher `sortOrder`.
- `assertRateCoverage(rules: RateRule[], targets: (string|null)[], packages: DomainPackage[]): void` replacing the per-call use of `assertWeekdayCoverage` (keep `assertWeekdayCoverage` exported for the no-package path or fold it in): no packages → unchanged rule (rates with `packageId` null cover 1–7 exactly once); with packages → every rate of that target names one of its packages, the full package covers 1–7 exactly once, others at most once each. Error `VALIDATION_FAILED` with details `{unitId, packageId?, weekdays}`.
- `assertPackages(packages, targets)`: target exists in `targets`, ≤ 10 per target, bedrooms distinct per target, names distinct case-insensitive per target.
- `assertNoOverrideOverlap` compares by (unitId, packageId).
- `priceNight(rules, unitId, night, packageId: string|null = null)` filters `r.unitId === unitId && r.packageId === packageId`.
- `QuoteProperty` gains nothing; `QuoteUnit` gains `maxGuests: number|null`. `quoteStay(p, units, rules, input, packages: DomainPackage[] = [])` with `QuoteInput.packageIds: string[]` (default treat missing as []). Implements the spec's "Quote" section exactly: per priced target, choose explicit package (must belong to the target, else `VALIDATION_FAILED`), else auto-pick (single package-target selection: fewest bedrooms whose `maxGuests ?? standard total` ≥ party and prices every night; else full package; multi-target: full package). Explicit package missing a night → `missing_rate` + `package_unavailable`. Standard party and `over_max` per the spec. `Quote.packages: {target, packageId, name}[]`.
- Whole rental of a rooms property: when a whole-target (null) rate exists for the night the target is null, as today; packages of target null apply there. Keep `targetsFor` semantics.

- [ ] Tests first (Aura example from the spec: 6 guests on Saturday auto-picks 5PN because 4PN is not sold Saturday, given 4PN max ≥ 6; 14 guests picks 6PN; explicit 4PN on Saturday → `missing_rate` + `package_unavailable`, totals null; coverage errors; override per package wins; no-package property unchanged). Then implement. Run `pnpm --filter backend exec vitest run src/modules/lodging/domain`.
- [ ] Commit `feat(backend): bedroom packages in lodging rates and quotes (T-193)`.

### Task 3: Backend — units, packages and rates persistence; property DTO

**Files:** `application/ports/lodging-store.ts`, `infrastructure/persistence/lodging.drizzle-store.ts`, `lodging.rows.ts`, `application/property.service.ts`, `property-support.ts`, `rates.service.ts`, the HTTP controller if needed, and their specs / `apps/backend/test` HTTP specs for lodging.

**Produces:**
- `UnitRecord` gains the new fields; `PackageRecord` (= `DomainPackage` + `propertyId`); store methods `packages(propertyIds)` and replace-packages inside the rates transaction; `RateRecord.packageId`.
- `PUT /units`: accepts and stores the new unit fields; validates each unit gallery with the same own-media checks as the property gallery (`IMAGE_NOT_UPLOADED`, `VIDEO_NOT_UPLOADED`), error `field` = `units[u].gallery[f].items[i].url`; a stale `galleryCover` that is not in the new gallery resets to '' (same rule as T-192 property PATCH). Deactivating a unit keeps its packages.
- `PUT /rates`: replaces packages (keep ids given; delete missing — a package referenced by a booking unit is set null by FK, acceptable) and rates; maps `packageKey` → package id; runs `assertPackages` + `assertRateCoverage` + `assertNoOverrideOverlap` over the resulting set (including existing overrides, which must still reference surviving packages — an override whose package is removed is deleted by cascade; say so in the docs task).
- Overrides create/patch accept `packageId` (must be a package of the same target).
- `GET /properties/{id}` and list return `packages`, rates with `packageId`, units with the new fields; `weekdaySell` of a whole property with packages uses the full package's prices.
- [ ] TDD at the service level (existing spec style) + HTTP spec for `PUT /rates` with packages and a 400 for a non-full package rate on a no-package target.
- [ ] Commit.

### Task 4: Backend — bookings, availability, calendar with packages

**Files:** `application/booking.service.ts`, `booking-support.ts`, `availability.ts`, `domain/availability-ranking.ts` (if needed), `calendar.service.ts`, persistence for booking units, their specs.

**Produces:**
- Create / edit booking accept `packageIds`; the quote receives the property's packages; chosen packages (from `quote.packages`) are stored on `lodging_booking_units.package_id` (whole rental of a rooms property: every row gets the whole-target package). Changing `packageIds` counts as a re-quote trigger like units/dates/party. A manual-price stay changing package must choose its price again (same rule as rooms).
- Booking DTO `packageIds` and `packageNames`; calendar segments `packageNames`.
- `freeOptions` passes packages to `quoteStay`; each `FreeOption` gains `packages` (from the quote) and `alternatives` (other packages of the single package target, each quoted with that explicit package: `{packageId, name, bedrooms, totalSell, fits}`, ordered by bedrooms ascending; empty unless the option has exactly one package target). `POST /availability` returns them; `POST /quote` returns `packages`.
- [ ] TDD; commit.

### Task 5: Bot — catalog, albums, holds, prompt @21, evals

**Files:** `apps/backend/src/modules/lodging/application/bot-product.ts`, `bot-catalog.ts`, `bot-hold.service.ts`, `bot-hold-support.ts`, `domain/hold-summary.ts`, `packages/contracts/src/commerce/lodging.schema.ts` (`AccommodationDetails`), `apps/backend/src/modules/ai/domain/image-allowlist.ts`, `ai/domain/product-view.ts`, `ai/application/output-tools.ts`, `ai/application/hold-tools.ts`, `packages/ai-core/prompts/sales-agent@21.md` (copy of @20 + rules), every place pinned to `sales-agent@20` (playground, eval CLI, industry wiring tests), `apps/backend/evals/lodging/*.yaml` (new cases), specs.

**Produces (per spec "Bot"):**
- `AccommodationDetails.units[]` gain `category, view, areaM2, description, amenities, maxGuests, albums` (albums same shape as the property's `albums`, optional); targets with packages get `packages: {name, bedrooms, standardAdults, standardChildren, maxGuests, weekdaySell: (number|null)[7]}[]` (on the property for the whole target, on the unit for a unit). Sell only.
- The ai allowlist includes unit albums and videos (ids unique); `send_message albumId/videoId` resolves them; paging unchanged.
- `check_availability` option output: `package` (name) and `alternatives: {package, bedrooms, totalSell, fits}[]`.
- `prepare_hold` input `packages?: {room?: string, package: string}[]`; resolves names case-insensitively against the option's targets; unknown → a problem `unknown_package` with `valid: string[]`. The draft stores `packageIds`; confirm passes them to the booking. The summary line names the package ("Nguyên căn · gói 5PN").
- Prompt @21 rules exactly as the spec's prompt bullet; eval cases: `hotel-aura-package-autopick.yaml` (6 guests Saturday → offers 5PN with its total), `hotel-resort-bungalow-album.yaml` (asks about Bungalow view đồi → sends that unit's album). Follow the existing eval YAML format in `apps/backend/evals/lodging/`.
- [ ] TDD for catalog, allowlist, tool parsing and hold flow; evals run in the deterministic/static mode the repo already uses in `evals.spec.ts`. Commit (`feat(backend)`, `feat(ai)` separately).

### Task 6: Web — packages in the rates tab

**Files:** `apps/web/src/features/lodging/components/rates-tab.tsx`, `rates-matrix.tsx`, `lib/rates-model.ts` (find the actual model file), `override-dialog.tsx`, `overrides-section.tsx`, new `packages-section.tsx`, api hooks for rates, i18n `lodging.packages.*`, tests.

**Produces:**
- A "Gói phòng" section (`PackagesSection`) above the matrix for a target (`unitId|null`): list rows with name, bedrooms, standard adults/children, max; add, edit inline, remove; client `key` for new packages (`crypto.randomUUID()`).
- The matrix shows, for a target with packages, one sell/cost row pair per package (label = package name; bedrooms descending; the full package first); a non-full package's empty cell is allowed and shows the placeholder "Không bán"; the full package's cells stay required. Saving builds `PutRatesRequest` with `packages` and `packageKey` per rate.
- Override dialog: package select when the target has packages (required then).
- A `target` filter prop on the rates editor so Task 7's unit page can show only one unit's rows while saving the full set.
- [ ] Component tests (add packages → three row pairs → save payload; empty non-full cell saves no rate for that weekday; full package empty cell blocks save). Screenshots 1440/390. Commit.

### Task 7: Web — unit cards, unit page, booking forms, calendar labels

**Files:** `rooms-tab.tsx` (→ unit cards), new `features/lodging/components/unit-page.tsx` (+ info form), new lazy route `apps/web/src/routes/app/properties/$propertyId.units.$unitId.tsx` (follow TanStack file-route naming used in the repo; lazy component), `gallery-tab.tsx` / gallery components reused for a unit gallery (generalise props, do not fork), `booking-create-form.tsx`, `booking-edit-form.tsx`, `booking-fields.tsx`, `quote-breakdown.tsx`, `find-availability-bar.tsx`, `calendar-grid.tsx` / `calendar-quick-view.tsx`, i18n, tests.

**Produces:**
- Rooms tab title "Đơn vị cho thuê": cards (cover via `galleryCoverUrl(unit.gallery, unit.galleryCover)`, name, category label, view, "Tiêu chuẩn N · Tối đa M", "từ X" = lowest weekday sell of that unit / its full package), plus the existing add/reorder/deactivate actions; clicking a card navigates to the unit page.
- Unit page tabs: **Thông tin** (fields per spec), **Giá** (Task 6 editor filtered to the unit, with its packages), **Ảnh & video** (folder UI on the unit gallery; upload/links identical to the property). Back link to the property. Dirty-state blocker like the property editor.
- Booking forms: per target with packages a select (default = quote's auto package); changing it re-quotes. Quote breakdown and Tìm trống show package names and alternatives' totals. Calendar bar / quick view show `packageNames`.
- [ ] Component tests; screenshots 1440/390 of unit cards, unit page tabs, booking form with a package select. Bundle check. Commit.

### Task 8: Docs, ADR-027, runbook, final check

**Files:** `docs/lodging.md`, `docs/06-ai-engine.md` §3.5, `docs/05-data-model.md` (lodging tables), `docs/adr/ADR-027-lodging-units-and-packages.md` + `docs/adr/README.md`, `docs/runbooks/deploy-vps.md` (rollback past 0067, after the 0066 section), `apps/backend/src/modules/lodging/MODULE.md`, `apps/backend/evals/README.md` if eval list is documented.

- [ ] Write docs per spec; run `pnpm check`; fix anything red within scope. Commit `docs: …`.
