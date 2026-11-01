# Lodging part 1 (properties, rates, calendar, bookings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the product-based hotel slice with a `lodging` module (properties → units → rates → nightly calendar → bookings) and the Lịch / Booking / Căn screens, so a central sales team can run 20–30 villas/homestays in Rapiz.

**Architecture:** New tier-2 backend module `lodging` (own tables, forced RLS, one PK `(workspace_id, unit_id, night)` as the anti-double-booking rule, lazy hold expiry). Pure domain functions for quoting and status. Contracts in `packages/contracts/src/lodging`. Web feature `features/lodging` with three routes. The `ai` module reads hotel properties through a lodging-backed `CatalogFacade`, so the reply pipeline is unchanged.

**Tech Stack:** NestJS 12 + Fastify, Drizzle + PostgreSQL 16, Zod contracts, Vitest, React 19 + TanStack Router/Query, shadcn/ui, Tailwind v4, react-i18next.

**Spec:** `docs/superpowers/specs/2026-11-01-lodging-calendar-design.md` (read it first; this plan argues from it).

## Global Constraints

- Worktree `/home/kenknight/Workspace/agent-sale-lodging`, branch `feat/T-160-lodging-calendar`. Never commit in `/home/kenknight/Workspace/agent-sale`.
- English for code, comments, commits, docs; Vietnamese only in `packages/i18n` vi messages.
- Module created only with `pnpm gen module lodging`; copy the shape of `apps/backend/src/modules/workspace` and the persistence pattern of `apps/backend/src/modules/commerce/infrastructure/persistence/lodging.drizzle-store.ts`.
- Every table: `workspace_id`, forced RLS via `tenantPolicies(...)`, UUIDv7 (`newId()` from `@agent-sales/shared`), money `bigint` integer VND, timestamps `timestamptz`.
- Migration number **0041** (0040 is taken on `feat/pms-kiotviet`). Additive only: T-155 routes/tables (`/stay-requests`, `products.accommodation`, `stay_requests`) stay served, unused by the UI.
- ADR number **ADR-018** (017 is taken on `feat/pms-kiotviet`).
- Hotel only: every lodging route returns `404 NOT_FOUND` when the workspace industry is not `hotel` (same as `LodgingService.assertHotel` today).
- Capabilities: properties/units/rates/settings write `catalog.manage`; everything else reads `orders.view`, writes `orders.manage`.
- Max stay 60 nights; calendar range ≤ 62 nights; gallery ≤ 30 images.
- Local timezone `Asia/Ho_Chi_Minh` for "today" and check-in rules.
- No colour-only status: every status shows text + pattern/icon.
- The word "sản phẩm" must not appear in hotel screens.
- `pnpm check` must pass before the PR. Subagents use `model: "opus"`.

## File map

```
packages/contracts/src/lodging/lodging.schema.ts        DTOs + requests (all lodging v2 types)
packages/contracts/src/lodging/lodging.routes.ts        route table (tag 'lodging')
packages/contracts/src/lodging/lodging.schema.test.ts
packages/contracts/src/commerce/lodging.schema.ts       (modify) AccommodationDetails additive fields
packages/contracts/src/index.ts                         (modify) export + allRoutes
packages/db/src/schema/lodging.ts                       Drizzle tables
packages/db/src/schema/index.ts                         (modify) export
packages/db/migrations/0041_lodging.sql                 tables, RLS, A17 copy
apps/backend/src/modules/lodging/                       generated module
  domain/quote.ts, domain/nights.ts, domain/booking-status.ts, domain/rates.ts, domain/lodging.errors.ts (+ .spec.ts)
  application/ports/lodging-store.ts
  application/property.service.ts, application/booking.service.ts, application/calendar.service.ts
  application/bot-catalog.ts                            CatalogFacade for hotel bots
  infrastructure/persistence/lodging.drizzle-store.ts
  interface/http/properties.controller.ts, bookings.controller.ts, calendar.controller.ts
  api/lodging.facade.ts, api/lodging.events.ts, api/index.ts, lodging.module.ts, MODULE.md
apps/backend/test/lodging-v2.integration.spec.ts
apps/backend/src/modules/ai/...                         (modify) pick lodging catalog for hotel bots
packages/ai-core/prompts/sales-agent@17.md
apps/web/src/features/lodging/api/*.ts, components/*, hooks/*
apps/web/src/routes/app/calendar.tsx, bookings.tsx, properties/index.tsx, properties/$propertyId.tsx
apps/web/src/routes/app/accommodations.tsx, stays.tsx  (modify) redirect
apps/web/src/components/layout/app-sidebar.tsx          (modify) hotel nav
packages/i18n/src/messages/{vi,en}/lodging.json         strings (or the existing pattern: check messages/ and vi.ts)
docs/adr/ADR-018-lodging-module.md, docs/lodging.md, docs/ARCHITECTURE.md, docs/05-data-model.md, docs/17-…md
```

---

### Task 1: Contracts

**Files:**
- Create: `packages/contracts/src/lodging/lodging.schema.ts`, `lodging.routes.ts`, `lodging.schema.test.ts`
- Modify: `packages/contracts/src/index.ts` (export `./lodging/lodging.schema.js`, `./lodging/lodging.routes.js`; append `lodgingV2Routes` to `allRoutes`), `packages/contracts/src/commerce/lodging.schema.ts` (additive `AccommodationDetails` fields)

**Interfaces (Produces)** — exact names used by every later task:

```ts
import { z } from 'zod';
export const IsoNight = z.iso.date();                    // 'YYYY-MM-DD'
export const Vnd = z.number().int().min(0).max(1_000_000_000_000);
export const SignedVnd = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
export const SellMode = z.enum(['whole', 'rooms']);
export const PropertyStatus = z.enum(['active', 'paused']);
export const UnitKind = z.enum(['whole', 'room']);
export const BookingKind = z.enum(['stay', 'block']);
export const BookingStatus = z.enum(['hold','confirmed','checked_in','checked_out','cancelled','expired','no_show','active','removed']);
export const BookingSource = z.enum(['messenger','zalo','phone','walk_in','owner','ota','bot','other']);
export const PriceRef = z.object({ sell: Vnd, cost: Vnd });

export const LayoutRoom = z.object({ name: z.string().trim().min(1).max(100), beds: z.string().trim().max(500).default(''), note: z.string().trim().max(500).default('') });
export const Policies = z.object({ checkInTime: z.string().max(50).default(''), checkOutTime: z.string().max(50).default(''), deposit: z.string().max(1000).default(''), cancellation: z.string().max(1000).default(''), houseRules: z.string().max(2000).default(''), other: z.string().max(2000).default('') });
export const GalleryImage = z.object({ url: z.string().url().max(2000), caption: z.string().trim().max(300).default('') });

export const PropertyInput = z.object({
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9-]+$/),
  name: z.string().trim().min(1).max(200),
  area: z.string().trim().max(200).default(''),
  address: z.string().trim().max(500).default(''),
  description: z.string().trim().max(5000).default(''),
  sellMode: SellMode,
  status: PropertyStatus.default('active'),
  standardAdults: z.number().int().min(1).max(1000),
  standardChildren: z.number().int().min(0).max(1000),
  maxGuests: z.number().int().min(1).max(2000).nullable().default(null),
  childFreeBelow: z.number().int().min(0).max(18).default(6),
  childAdultFrom: z.number().int().min(1).max(18).default(12),
  amenities: z.array(z.string().trim().min(1).max(200)).max(80).default([]),
  layout: z.array(LayoutRoom).max(100).default([]),
  policies: Policies.default({}),
  gallery: z.array(GalleryImage).max(30).default([]),
}).refine((v) => v.childFreeBelow <= v.childAdultFrom, 'childFreeBelow must not exceed childAdultFrom');
export type PropertyInput = z.input<typeof PropertyInput>;
export const UpdatePropertyRequest = z.object({ version: z.number().int().positive(), patch: PropertyInput.innerType().partial() });

export const UnitDto = z.object({ id: z.uuid(), kind: UnitKind, name: z.string(), beds: z.string(), capacityAdults: z.number().int(), capacityChildren: z.number().int(), active: z.boolean(), sortOrder: z.number().int() });
export const UnitInput = z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(100), beds: z.string().trim().max(500).default(''), capacityAdults: z.number().int().min(1).max(100), capacityChildren: z.number().int().min(0).max(100).default(0), active: z.boolean().default(true) });
export const ReplaceUnitsRequest = z.object({ version: z.number().int().positive(), units: z.array(UnitInput).min(1).max(100) });

export const WeekdayRate = z.object({ unitId: z.uuid().nullable(), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7), sell: Vnd, cost: Vnd });
export const Surcharges = z.object({ extraAdult: PriceRef.nullable(), extraChild: PriceRef.nullable() });
export const PutRatesRequest = z.object({ version: z.number().int().positive(), weekday: z.array(WeekdayRate).min(1).max(800), surcharges: Surcharges });
export const OverrideInput = z.object({ unitId: z.uuid().nullable(), dateFrom: IsoNight, dateTo: IsoNight, label: z.string().trim().min(1).max(100), sell: Vnd, cost: Vnd, minNights: z.number().int().min(1).max(60).nullable().default(null) });
export const RateDto = z.object({ id: z.uuid(), unitId: z.uuid().nullable(), kind: z.enum(['weekday','override']), weekdays: z.array(z.number().int()), dateFrom: IsoNight.nullable(), dateTo: IsoNight.nullable(), label: z.string(), sell: Vnd, cost: Vnd, minNights: z.number().int().nullable() });

export const PropertyDto = PropertyInput.innerType().extend({ id: z.uuid(), units: z.array(UnitDto), rates: z.array(RateDto), surcharges: Surcharges, version: z.number().int(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const PropertySummary = PropertyDto.omit({ rates: true }).extend({ today: z.enum(['free','hold','occupied','blocked','partial']) });
export const PropertyList = z.object({ data: z.array(PropertySummary) });

export const Party = z.object({ adults: z.number().int().min(0).max(1000), childAges: z.array(z.number().int().min(0).max(17)).max(1000).default([]) });
export const StaySelection = z.object({ propertyId: z.uuid(), whole: z.boolean(), unitIds: z.array(z.uuid()).max(100).default([]), checkIn: IsoNight, checkOut: IsoNight });
export const QuoteRequest = StaySelection.extend({ party: Party });
export const QuoteNight = z.object({ date: IsoNight, weekday: z.number().int(), label: z.string(), sell: Vnd, cost: Vnd });
export const QuoteSurcharge = z.object({ kind: z.enum(['extra_adult','extra_child']), persons: z.number().int(), nights: z.number().int(), sell: Vnd, cost: Vnd });
export const QuoteWarning = z.enum(['min_nights','missing_rate','over_max','over_standard','child_ages_missing']);
export const QuoteDto = z.object({ nights: z.array(QuoteNight), surcharges: z.array(QuoteSurcharge), totalSell: Vnd.nullable(), totalCost: Vnd.nullable(), warnings: z.array(QuoteWarning), takenBy: z.array(z.string()) /* booking codes occupying requested nights */ });

export const CreateBookingRequest = z.discriminatedUnion('kind', [
  StaySelection.extend({ kind: z.literal('stay'), clientRequestId: z.uuid(), status: z.enum(['hold','confirmed']), party: Party, guestName: z.string().trim().min(1).max(200), guestPhone: z.string().trim().max(30).default(''), source: BookingSource, contactId: z.uuid().nullable().default(null), conversationId: z.uuid().nullable().default(null), adjustment: SignedVnd.default(0), adjustmentReason: z.string().max(300).default(''), manualTotalSell: Vnd.nullable().default(null), note: z.string().max(2000).default('') }),
  StaySelection.extend({ kind: z.literal('block'), clientRequestId: z.uuid(), blockReason: z.string().trim().min(1).max(300) }),
]);
export const UpdateBookingRequest = z.object({ version: z.number().int().positive(), checkIn: IsoNight.optional(), checkOut: IsoNight.optional(), whole: z.boolean().optional(), unitIds: z.array(z.uuid()).max(100).optional(), party: Party.optional(), guestName: z.string().trim().min(1).max(200).optional(), guestPhone: z.string().trim().max(30).optional(), adjustment: SignedVnd.optional(), adjustmentReason: z.string().max(300).optional(), manualTotalSell: Vnd.nullable().optional(), note: z.string().max(2000).optional() });
export const BookingAction = z.enum(['confirm','check_in','check_out','cancel','no_show','extend_hold','remove_block']);
export const BookingStatusRequest = z.object({ version: z.number().int().positive(), action: BookingAction, reason: z.string().max(300).default(''), holdMinutes: z.number().int().min(15).max(1440).optional() });

export const BookingDto = z.object({ id: z.uuid(), code: z.string(), propertyId: z.uuid(), propertyCode: z.string(), propertyName: z.string(), kind: BookingKind, whole: z.boolean(), unitIds: z.array(z.uuid()), unitNames: z.array(z.string()), status: BookingStatus, checkIn: IsoNight, checkOut: IsoNight, party: Party, guestName: z.string(), guestPhone: z.string(), contactId: z.uuid().nullable(), conversationId: z.uuid().nullable(), source: BookingSource.nullable(), holdExpiresAt: z.iso.datetime().nullable(), quote: QuoteDto.nullable(), adjustment: SignedVnd, adjustmentReason: z.string(), totalSell: Vnd.nullable(), totalCost: Vnd.nullable(), note: z.string(), blockReason: z.string(), version: z.number().int(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const BookingHistoryEntry = z.object({ at: z.iso.datetime(), actorName: z.string().nullable(), action: z.string(), data: z.record(z.string(), z.unknown()) });
export const BookingDetail = BookingDto.extend({ history: z.array(BookingHistoryEntry) });
export const BookingListQuery = z.object({ view: z.enum(['today','holds','upcoming','all']).default('upcoming'), propertyId: z.uuid().optional(), status: BookingStatus.optional(), q: z.string().max(100).optional(), conversationId: z.uuid().optional(), offset: z.coerce.number().int().min(0).default(0) });
export const BookingList = z.object({ data: z.array(BookingDto), nextOffset: z.number().int().nullable() });

export const CalendarQuery = z.object({ from: IsoNight, to: IsoNight, propertyIds: z.string().optional() /* comma-separated uuids */ });
export const CalendarSegment = z.object({ bookingId: z.uuid(), code: z.string(), kind: BookingKind, status: BookingStatus, from: IsoNight, to: IsoNight /* exclusive */, guestName: z.string(), blockReason: z.string(), holdExpiresAt: z.iso.datetime().nullable() });
export const CalendarRow = z.object({ unitId: z.uuid(), name: z.string(), kind: UnitKind, prices: z.array(z.object({ night: IsoNight, sell: Vnd.nullable(), label: z.string() })), segments: z.array(CalendarSegment) });
export const CalendarProperty = z.object({ id: z.uuid(), code: z.string(), name: z.string(), area: z.string(), sellMode: SellMode, standardAdults: z.number().int(), standardChildren: z.number().int(), wholePrices: z.array(z.object({ night: IsoNight, sell: Vnd.nullable(), label: z.string() })), rows: z.array(CalendarRow) });
export const CalendarDto = z.object({ from: IsoNight, to: IsoNight, today: IsoNight, properties: z.array(CalendarProperty) });

export const AvailabilityRequest = z.object({ checkIn: IsoNight, checkOut: IsoNight, party: Party, propertyIds: z.array(z.uuid()).max(200).optional() });
export const AvailabilityOption = z.object({ propertyId: z.uuid(), whole: z.boolean(), unitIds: z.array(z.uuid()), fits: z.boolean(), quote: QuoteDto });
export const AvailabilityDto = z.object({ options: z.array(AvailabilityOption) });

export const LodgingSettings = z.object({ holdMinutes: z.number().int().min(15).max(1440) });
export const BotPropertiesDto = z.object({ propertyIds: z.array(z.uuid()) });
```

Routes (`lodgingV2Routes`, `{ tag: 'lodging', auth: true, workspaceScoped: true }`), paths exactly as spec §4: `GET/POST /lodging/properties`, `GET/PATCH /lodging/properties/{id}`, `PUT /lodging/properties/{id}/units`, `PUT /lodging/properties/{id}/rates`, `POST /lodging/properties/{id}/overrides`, `PATCH/DELETE /lodging/properties/{id}/overrides/{rateId}`, `GET /lodging/calendar`, `POST /lodging/availability` (200), `POST /lodging/quote` (200), `GET/POST /lodging/bookings`, `GET/PATCH /lodging/bookings/{id}`, `POST /lodging/bookings/{id}/status` (200), `GET/PATCH /lodging/settings`, `GET/PUT /lodging/bots/{botId}/properties`. PATCH override body: `OverrideInput.partial().extend({ version })` where `version` is the property version; DELETE takes `?version=`.

Additive change to `AccommodationDetails` (commerce/lodging.schema.ts): `rentalType: z.enum(['entire_property','rooms'])`; new optional `code: z.string().optional()`, `units: z.array(z.object({ name, beds, capacityAdults, capacityChildren, weekdayRates: z.array(z.object({ days, amount })) })).optional()`, `overrides: z.array(z.object({ dateFrom, dateTo, label, amount, unitName: z.string().nullable() })).optional()`, `surcharges: z.object({ extraAdult: Amount.nullable(), extraChild: Amount.nullable(), childFreeBelow, childAdultFrom }).optional()`; relax the `roomLayout.length === bedrooms` refine to apply only when `rentalType === 'entire_property'`.

- [ ] **Step 1:** Write `lodging.schema.test.ts`: `PropertyInput` rejects `childFreeBelow > childAdultFrom`; `CreateBookingRequest` parses a `stay` and a `block`, rejects a block without reason; `BookingStatusRequest` rejects unknown action; `AccommodationDetails` still parses the A17 object stored today (copy the JSON from spec/DB: rentalType entire_property, 8 layout rows, bedrooms 8) and parses a `rooms` object with 3 layout rows and `bedrooms: 5`.
- [ ] **Step 2:** `pnpm --filter @agent-sales/contracts exec vitest run src/lodging` → FAIL (module missing).
- [ ] **Step 3:** Implement the schema, routes, index exports.
- [ ] **Step 4:** `pnpm --filter @agent-sales/contracts test && pnpm --filter @agent-sales/contracts typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(contracts): lodging v2 DTOs and routes (T-160)`.

---

### Task 2: Pure domain — rates validation, nights, quote, status

**Files:** Create in `apps/backend/src/modules/lodging/domain/` (after `pnpm gen module lodging` — run the generator in this task; fill `MODULE.md` minimal now, complete in Task 9): `lodging.errors.ts`, `nights.ts`, `rates.ts`, `quote.ts`, `booking-status.ts`, and specs `nights.spec.ts`, `rates.spec.ts`, `quote.spec.ts`, `booking-status.spec.ts`.

**Interfaces (Produces):**

```ts
// lodging.errors.ts
export type LodgingErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED' | 'NIGHTS_TAKEN' | 'STALE_VERSION';
export class LodgingError extends DomainError { constructor(readonly code: LodgingErrorCode, message: string, readonly details?: Record<string, unknown>) { super(message); } }

// nights.ts
export function nightsBetween(checkIn: string, checkOut: string): string[];  // ['2026-11-06','2026-11-07'] for 06→08; throws VALIDATION_FAILED if <1 or >60
export function isoWeekday(night: string): number;                         // 1=Mon … 7=Sun, UTC-safe
export function localToday(now: Date, tz?: string): string;                 // 'YYYY-MM-DD' in Asia/Ho_Chi_Minh (Intl.DateTimeFormat 'en-CA')

// rates.ts
export interface RateRule { id: string; unitId: string | null; kind: 'weekday' | 'override'; weekdays: number[]; dateFrom: string | null; dateTo: string | null; label: string; sell: number; cost: number; minNights: number | null }
export function assertWeekdayCoverage(rules: RateRule[], targets: (string | null)[]): void; // each target: weekdays 1..7 exactly once, else VALIDATION_FAILED
export function assertNoOverrideOverlap(rules: RateRule[]): void;                          // same unitId overrides must not overlap (inclusive dates)
export function priceNight(rules: RateRule[], unitId: string | null, night: string): { sell: number; cost: number; label: string; minNights: number | null } | null;

// quote.ts
export interface QuoteProperty { sellMode: 'whole' | 'rooms'; standardAdults: number; standardChildren: number; maxGuests: number | null; childFreeBelow: number; childAdultFrom: number; surcharges: { extraAdult: { sell: number; cost: number } | null; extraChild: { sell: number; cost: number } | null } }
export interface QuoteUnit { id: string; kind: 'whole' | 'room'; capacityAdults: number; capacityChildren: number; active: boolean }
export interface QuoteInput { whole: boolean; unitIds: string[]; checkIn: string; checkOut: string; adults: number; childAges: number[] }
export interface Quote { nights: { date: string; weekday: number; label: string; sell: number; cost: number }[]; surcharges: { kind: 'extra_adult' | 'extra_child'; persons: number; nights: number; sell: number; cost: number }[]; totalSell: number | null; totalCost: number | null; warnings: ('min_nights'|'missing_rate'|'over_max'|'over_standard'|'child_ages_missing')[] }
export function resolveUnits(p: QuoteProperty, units: QuoteUnit[], input: Pick<QuoteInput,'whole'|'unitIds'>): string[]; // whole: the whole unit (sellMode whole) or all active rooms; else the given active rooms (VALIDATION_FAILED if empty/unknown/inactive or sellMode whole with whole=false)
export function quoteStay(p: QuoteProperty, units: QuoteUnit[], rules: RateRule[], input: QuoteInput): Quote;

// booking-status.ts
export type StayStatus = 'hold'|'confirmed'|'checked_in'|'checked_out'|'cancelled'|'expired'|'no_show';
export type Action = 'confirm'|'check_in'|'check_out'|'cancel'|'no_show'|'extend_hold'|'remove_block';
export function nextStatus(kind: 'stay'|'block', from: string, action: Action, today: string, checkIn: string): string; // CONFLICT on illegal move; check_in only when today >= checkIn; extend_hold keeps 'hold'; remove_block: active→removed
export const OCCUPYING: readonly string[] = ['hold','confirmed','checked_in','checked_out','active'];
```

Quote rules (implement exactly):
1. `nights = nightsBetween(checkIn, checkOut)`.
2. Price target per night: if `whole` and the property has whole-target rules (`unitId === null`) → `priceNight(rules, null, night)`; if `whole` on a `rooms` property without whole rules → sum of `priceNight(rules, roomId, night)` over all active rooms; else sum over selected rooms. Any `null` → push `missing_rate`, skip that night's price (line `sell: 0, cost: 0, label: ''`), and `totalSell/totalCost = null`.
3. Label: the override label when one applied (for a sum, the first non-empty label).
4. `min_nights` when any priced night's `minNights > nights.length`.
5. Standard: whole → `(standardAdults, standardChildren)`; rooms → sum of selected rooms' `(capacityAdults, capacityChildren)`.
6. Children: age `< childFreeBelow` → "small" (counts against standard children, never charged); `childFreeBelow ≤ age < childAdultFrom` → "child"; `age ≥ childAdultFrom` → adult. Extra adults = `max(0, adults + olderAsAdults - stdAdults)`. Extra children = `max(0, small + child - stdChildren)` but only the "child" band is chargeable: `chargeableChildren = min(extraChildren, child)`; extra small children beyond the standard → `over_standard` warning (not charged).
7. Surcharge lines when count > 0 and the surcharge is configured: `{persons, nights: n, sell: persons*n*price.sell, cost: …}`. Count > 0 without a configured surcharge → `over_standard`.
8. `over_max` when `maxGuests !== null && adults + childAges.length > maxGuests`.
9. `child_ages_missing` is never produced here (contracts require ages; the bot path in part 3 may pass unknown ages).

- [ ] **Step 1: Write failing specs** (Vitest, `describe/it/expect`), at least:
  - `nightsBetween('2026-11-06','2026-11-08')` → `['2026-11-06','2026-11-07']`; same day → throws; 61 nights → throws.
  - `isoWeekday('2026-11-08')` → 7 (Sunday), `('2026-11-09')` → 1.
  - `localToday(new Date('2026-11-01T18:30:00Z'))` → `'2026-11-02'`.
  - `assertWeekdayCoverage` passes for A17 rules `[1,2,3,4]/12m, [5,7]/13m, [6]/14m`; fails for missing 7 and for duplicate 5.
  - `assertNoOverrideOverlap` fails for `12-30..01-02` and `01-01..01-03` same unit; passes for different units.
  - A17 quote Fri 06/11→Sun 08/11, 20 adults: nights `[{2026-11-06,5,13m},{2026-11-07,6,14m}]`, total 27,000,000.
  - Override "Tết" 2027-02-05..2027-02-08 at 20m with minNights 2 wins over weekday; 1-night stay inside → warning `min_nights`.
  - Surcharge: standard 24+8 (childFreeBelow 6, childAdultFrom 12), extraAdult 300k sell/200k cost, extraChild 150k/100k; party 26 adults + ages [3,7,13]: older 13 → adult → extra adults 3, children small 1 + child 1 within 8 → no child surcharge; 2 nights → line extra_adult persons 3 nights 2 sell 1,800,000.
  - Rooms property with rooms P1 (2+1, 1.2m weekday all days), P2 (2+0, 1.0m): selection [P1,P2], 1 night → 2.2m; whole without whole rules → 2.2m; whole with whole rule 2.0m → 2.0m.
  - Missing rate for a room → `missing_rate`, totals null.
  - `nextStatus('stay','hold','confirm',…)` → confirmed; `('stay','checked_out','cancel')` throws CONFLICT; `check_in` with today < checkIn throws; `('block','active','remove_block')` → removed.
- [ ] **Step 2:** `pnpm --filter @agent-sales/backend exec vitest run src/modules/lodging/domain` → FAIL.
- [ ] **Step 3:** Implement the five files (domain imports only `@agent-sales/shared`).
- [ ] **Step 4:** Re-run → PASS. `pnpm --filter @agent-sales/backend typecheck`.
- [ ] **Step 5:** Commit `feat(lodging): pure quote, rates and booking status domain (T-160)`.

---

### Task 3: Database schema + migration 0041

**Files:** Create `packages/db/src/schema/lodging.ts`, `packages/db/migrations/0041_lodging.sql`; modify `packages/db/src/schema/index.ts`. Follow `packages/db/src/schema/commerce.ts` (`workspaceRef()`, `tenantPolicies()`), and `packages/db/migrations/0035_lodging_stay_requests.sql` for RLS/GRANT SQL. Check how the migration runner validates checksums/ordering (`packages/db/src/migrate.ts`) and whether migrations must be mirrored in Drizzle schema tests.

Tables (SQL names; Drizzle exports in camelCase `lodgingProperties`, …):

```sql
CREATE TABLE lodging_properties (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  code text NOT NULL, name text NOT NULL, area text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '', sell_mode text NOT NULL CHECK (sell_mode IN ('whole','rooms')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  standard_adults int NOT NULL CHECK (standard_adults > 0), standard_children int NOT NULL DEFAULT 0 CHECK (standard_children >= 0),
  max_guests int CHECK (max_guests IS NULL OR max_guests > 0),
  child_free_below int NOT NULL DEFAULT 6, child_adult_from int NOT NULL DEFAULT 12,
  amenities jsonb NOT NULL DEFAULT '[]', layout jsonb NOT NULL DEFAULT '[]', policies jsonb NOT NULL DEFAULT '{}', gallery jsonb NOT NULL DEFAULT '[]',
  extra_adult_sell bigint, extra_adult_cost bigint, extra_child_sell bigint, extra_child_cost bigint,
  source_product_id uuid, sort_order int NOT NULL DEFAULT 0, version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lodging_properties_code_unique UNIQUE (workspace_id, code),
  CONSTRAINT lodging_properties_ws_id UNIQUE (workspace_id, id)
);
CREATE TABLE lodging_units (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, property_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('whole','room')), name text NOT NULL, beds text NOT NULL DEFAULT '',
  capacity_adults int NOT NULL DEFAULT 1, capacity_children int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0,
  FOREIGN KEY (workspace_id, property_id) REFERENCES lodging_properties(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT lodging_units_ws_id UNIQUE (workspace_id, id)
);
CREATE TABLE lodging_rates (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, property_id uuid NOT NULL, unit_id uuid,
  kind text NOT NULL CHECK (kind IN ('weekday','override')), weekdays int[] NOT NULL DEFAULT '{}',
  date_from date, date_to date, label text NOT NULL DEFAULT '', sell bigint NOT NULL CHECK (sell >= 0), cost bigint NOT NULL CHECK (cost >= 0), min_nights int,
  FOREIGN KEY (workspace_id, property_id) REFERENCES lodging_properties(workspace_id, id) ON DELETE CASCADE,
  CHECK ((kind = 'weekday' AND date_from IS NULL) OR (kind = 'override' AND date_from IS NOT NULL AND date_to >= date_from))
);
CREATE TABLE lodging_settings (workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), hold_minutes int NOT NULL DEFAULT 120 CHECK (hold_minutes BETWEEN 15 AND 1440), booking_seq int NOT NULL DEFAULT 0);
CREATE TABLE lodging_bookings (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, property_id uuid NOT NULL, code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('stay','block')), whole boolean NOT NULL, status text NOT NULL,
  check_in date NOT NULL, check_out date NOT NULL, adults int NOT NULL DEFAULT 0, child_ages int[] NOT NULL DEFAULT '{}',
  guest_name text NOT NULL DEFAULT '', guest_phone text NOT NULL DEFAULT '', contact_id uuid, conversation_id uuid, source text,
  hold_expires_at timestamptz, quote jsonb, adjustment bigint NOT NULL DEFAULT 0, adjustment_reason text NOT NULL DEFAULT '',
  total_sell bigint, total_cost bigint, note text NOT NULL DEFAULT '', block_reason text NOT NULL DEFAULT '',
  client_request_id uuid NOT NULL, fingerprint text NOT NULL, created_by uuid, version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, property_id) REFERENCES lodging_properties(workspace_id, id),
  CONSTRAINT lodging_bookings_code_unique UNIQUE (workspace_id, code),
  CONSTRAINT lodging_bookings_request_unique UNIQUE (workspace_id, client_request_id),
  CONSTRAINT lodging_bookings_ws_id UNIQUE (workspace_id, id),
  CHECK (check_out > check_in AND check_out - check_in <= 60),
  CHECK ((kind = 'stay' AND status IN ('hold','confirmed','checked_in','checked_out','cancelled','expired','no_show')) OR (kind = 'block' AND status IN ('active','removed'))),
  CHECK (status <> 'hold' OR hold_expires_at IS NOT NULL)
);
CREATE INDEX lodging_bookings_dates_idx ON lodging_bookings(workspace_id, property_id, check_in, check_out);
CREATE INDEX lodging_bookings_hold_idx ON lodging_bookings(workspace_id, hold_expires_at) WHERE status = 'hold';
CREATE INDEX lodging_bookings_conversation_idx ON lodging_bookings(workspace_id, conversation_id) WHERE conversation_id IS NOT NULL;
CREATE TABLE lodging_booking_units (workspace_id uuid NOT NULL, booking_id uuid NOT NULL, unit_id uuid NOT NULL, PRIMARY KEY (workspace_id, booking_id, unit_id),
  FOREIGN KEY (workspace_id, booking_id) REFERENCES lodging_bookings(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, unit_id) REFERENCES lodging_units(workspace_id, id));
CREATE TABLE lodging_unit_nights (workspace_id uuid NOT NULL, unit_id uuid NOT NULL, night date NOT NULL, booking_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, unit_id, night),
  FOREIGN KEY (workspace_id, booking_id) REFERENCES lodging_bookings(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, unit_id) REFERENCES lodging_units(workspace_id, id));
CREATE TABLE lodging_bot_properties (workspace_id uuid NOT NULL, bot_id uuid NOT NULL, property_id uuid NOT NULL, PRIMARY KEY (workspace_id, bot_id, property_id),
  FOREIGN KEY (workspace_id, property_id) REFERENCES lodging_properties(workspace_id, id) ON DELETE CASCADE);
-- RLS + GRANT for all 8 tables exactly like 0035 (ENABLE, FORCE, policy <table>_tenant TO app_tenant USING/WITH CHECK workspace_id = current_setting('app.workspace_id', true)::uuid, GRANT SELECT, INSERT, UPDATE, DELETE TO app_tenant).
```

Data copy at the end of the migration (runs as the migration owner, bypassing RLS): for every `products` row with `accommodation IS NOT NULL` and no existing `lodging_properties.source_product_id` = its id:
- property: `code` = `'P' || left(replace(p.id::text,'-',''),6)` unless the name contains `A17` → `'A17'` (use `CASE WHEN p.name ~* 'A17' THEN 'A17' ELSE … END`); `name` = the text before ' – ' in `p.name` when present, else `p.name`; `area` = `'Sân golf Tam Đảo'` when the name contains 'Tam Đảo' else `''`; `description` = `p.description` (check the column name in `products`); `sell_mode 'whole'`; standard/child/max from the JSON (`childAgeBelow` → `child_free_below`, `child_adult_from` 12); amenities; `layout` = `roomLayout` mapped to `{name, beds, note:''}`; `policies` = `{checkInTime: checkInOut, deposit: depositPolicy, cancellation: cancellationPolicy, other: trim(extraGuestPolicy || ' ' || holidayPolicy)}`; gallery as is; `source_product_id` = p.id. Use `gen_random_uuid()` if there is no uuidv7 SQL function (check other migrations for the convention).
- one unit `kind 'whole'`, `name` = property name, capacity = standard adults/children.
- one `weekday` rate per `rates[]` element, `unit_id NULL`, `sell = cost = amount`.
- `lodging_bot_properties` from `bot_products` rows for that product (check table/column names in schema `bot.ts`/`commerce.ts`); if the bot sells all products (`catalog_mode = 'all'` on bots), link every bot of the workspace.
- confirmed `stay_requests` → `lodging_bookings` status `confirmed` + units + nights (dev DB has 0 rows; write it anyway, guarded).

- [ ] **Step 1:** Add the Drizzle schema mirroring the SQL (types `bigint({mode:'number'})`, `date({mode:'string'})`, `integer().array()`), export from `schema/index.ts`.
- [ ] **Step 2:** Write `apps/backend/test/lodging-migration.integration.spec.ts` (copy the DB bootstrapping of `apps/backend/test/lodging.integration.spec.ts`): seed a hotel workspace with a product carrying the A17 accommodation JSON, run the copy SQL block (extract it into a function in the migration file only if the runner allows; otherwise test via the migrated DB fixture used by other integration tests — inspect `apps/backend/test/setup.ts`), assert 1 property code `A17`, 1 whole unit, 3 weekday rates covering 1..7, 8 layout rows, 12 gallery images.
- [ ] **Step 3:** Run `pnpm --filter @agent-sales/backend exec vitest run --config vitest.integration.config.ts test/lodging-migration.integration.spec.ts` → FAIL, then add the migration → PASS.
- [ ] **Step 4:** `pnpm --filter @agent-sales/db typecheck && pnpm --filter @agent-sales/db test`.
- [ ] **Step 5:** Commit `feat(db): lodging tables, RLS and A17 copy (T-160)`.

---

### Task 4: Store port + Drizzle adapter

**Files:** `apps/backend/src/modules/lodging/application/ports/lodging-store.ts`, `infrastructure/persistence/lodging.drizzle-store.ts`, `infrastructure/persistence/lodging.rows.ts`.

**Interfaces (Produces):**

```ts
export interface PropertyRecord { id: string; code: string; name: string; area: string; address: string; description: string; sellMode: 'whole'|'rooms'; status: 'active'|'paused'; standardAdults: number; standardChildren: number; maxGuests: number|null; childFreeBelow: number; childAdultFrom: number; amenities: string[]; layout: {name:string;beds:string;note:string}[]; policies: Policies; gallery: {url:string;caption:string}[]; surcharges: { extraAdult: {sell:number;cost:number}|null; extraChild: {sell:number;cost:number}|null }; sortOrder: number; version: number; createdAt: string; updatedAt: string }
export interface UnitRecord { id: string; propertyId: string; kind: 'whole'|'room'; name: string; beds: string; capacityAdults: number; capacityChildren: number; active: boolean; sortOrder: number }
export interface BookingRecord { /* every BookingDto field except propertyCode/propertyName/unitNames */ id: string; code: string; propertyId: string; kind: 'stay'|'block'; whole: boolean; unitIds: string[]; status: string; checkIn: string; checkOut: string; adults: number; childAges: number[]; guestName: string; guestPhone: string; contactId: string|null; conversationId: string|null; source: string|null; holdExpiresAt: string|null; quote: Quote|null; adjustment: number; adjustmentReason: string; totalSell: number|null; totalCost: number|null; note: string; blockReason: string; clientRequestId: string; fingerprint: string; version: number; createdAt: string; updatedAt: string }
export interface LodgingTx {
  properties(filter?: { ids?: string[]; activeOnly?: boolean }): Promise<PropertyRecord[]>;
  property(id: string, lock?: boolean): Promise<PropertyRecord | null>;
  insertProperty(p: PropertyRecord): Promise<void>;
  updateProperty(p: PropertyRecord): Promise<void>;              // caller bumps version
  units(propertyIds: string[]): Promise<UnitRecord[]>;
  replaceUnits(propertyId: string, units: UnitRecord[]): Promise<void>; // upsert by id, delete missing (FK blocks units with nights → map 23503 to CONFLICT)
  rates(propertyIds: string[]): Promise<RateRule[]>;
  replaceWeekdayRates(propertyId: string, rules: RateRule[]): Promise<void>;
  insertOverride(propertyId: string, r: RateRule): Promise<void>;
  updateOverride(propertyId: string, r: RateRule): Promise<void>;
  deleteOverride(propertyId: string, rateId: string): Promise<boolean>;
  settings(): Promise<{ holdMinutes: number }>;
  updateSettings(s: { holdMinutes: number }): Promise<void>;
  nextBookingCode(): Promise<string>;                            // upsert settings row, increment booking_seq, 'BK-' + padStart(4,'0')
  lockRequestKey(key: string): Promise<void>;
  findBooking(id: string, lock?: boolean): Promise<BookingRecord | null>;
  findBookingByRequest(clientRequestId: string): Promise<BookingRecord | null>;
  listBookings(q: BookingListQuery & { today: string }): Promise<BookingRecord[]>; // 101 rows max
  bookingsInRange(propertyIds: string[], from: string, to: string): Promise<BookingRecord[]>; // occupying statuses overlapping [from,to)
  insertBooking(b: BookingRecord): Promise<void>;
  updateBooking(b: BookingRecord): Promise<void>;
  takeNights(bookingId: string, unitIds: string[], nights: string[]): Promise<void>; // throws LodgingError('NIGHTS_TAKEN', …, { codes }) on 23505
  releaseNights(bookingId: string): Promise<void>;
  takenNights(unitIds: string[], from: string, to: string): Promise<{ unitId: string; night: string; bookingId: string; code: string }[]>;
  expireOverdueHolds(now: Date): Promise<BookingRecord[]>;        // status→expired, delete nights, return them
  botPropertyIds(botId: string): Promise<string[] | null>;       // null = no rows for this bot (= every active property)
  setBotProperties(botId: string, propertyIds: string[]): Promise<void>;
  history(bookingId: string): Promise<{ at: string; actorName: string|null; action: string; data: Record<string, unknown> }[]>; // from audit_logs target_type 'lodging_booking'
  audit(actorId: string | null, targetType: 'lodging_property'|'lodging_booking', id: string, action: string, data: Record<string, unknown>): Promise<void>;
  publish(event: { name: string; payload: Record<string, unknown> }): Promise<void>; // outbox, same tx (see workspace OutboxEventPublisher)
}
export interface LodgingStore { run<T>(ws: WorkspaceId, fn: (tx: LodgingTx) => Promise<T>): Promise<T> }
export const LODGING_STORE = Symbol('LODGING_STORE');
```

`takeNights` on unique violation re-queries the conflicting booking codes (outside the failed statement: use a SAVEPOINT via `tx.transaction` nested call, or pre-check with `takenNights` then insert and still map 23505 for the race). Reading `history` uses the audit table read pattern already in the repo (grep `auditLogs` / `audit_logs` in `packages/db`).

- [ ] **Step 1:** Write `apps/backend/test/lodging-v2.integration.spec.ts` store-level cases: insert property + unit, `takeNights` twice for same unit-night in two concurrent `store.run` calls → exactly one rejects with `NIGHTS_TAKEN` and `details.codes` contains the winner's code; RLS: another workspace's `run` sees 0 properties; `nextBookingCode` returns `BK-0001`, `BK-0002`; `expireOverdueHolds` expires a hold with past expiry and frees its nights.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(lodging): tenant-scoped store with nightly occupancy (T-160)`.

---

### Task 5: Property service + controller (properties, units, rates, overrides, settings, bot properties)

**Files:** `application/property.service.ts`, `interface/http/properties.controller.ts`, `lodging.module.ts` (wire `LODGING_STORE` → `DrizzleLodgingStore` using the DB provider as commerce does; import `WorkspaceModule` for `WORKSPACE_FACADE`), `apps/backend/src/app.module.ts` (or wherever modules are listed for the api entry) — add `LodgingModule`.

**Behaviour:**
- `assertHotel(ws)` exactly like `commerce/application/lodging.service.ts`.
- `create`: validate `PropertyInput`; insert property; if `sellMode === 'whole'` create the single `whole` unit (name = property name, capacity = standard); if `rooms`, no units yet (UI's Phòng tab adds them). Default weekday rule set: none (Giá tab required before booking; quote yields `missing_rate`). Audit `lodging.property.created`.
- `update`: version check (`STALE_VERSION`); `sellMode` change refused (`CONFLICT`) when any booking with `check_out > today` and occupying status exists; switching to `whole` creates the whole unit and deactivates rooms; switching to `rooms` deactivates the whole unit. Whole unit name/capacity follow the property.
- `replaceUnits`: only for `rooms` properties; room units only; deleting a unit with nights → `CONFLICT` "deactivate instead".
- `putRates`: build `RateRule[]` (kind weekday), `assertWeekdayCoverage(rules, targets)` where targets = `[null]` for whole mode, or the set of distinct `unitId`s given (every active room must be a target; `null` optional for rooms mode); save surcharges on the property; bump version.
- Overrides: `assertNoOverrideOverlap` over existing + new; bump property version.
- `list` returns `PropertySummary` with `today` computed from `takenNights(units, today, today+1)` and booking statuses (`occupied` if a checked_in/confirmed stay covers today on every unit, `partial` if some units, `hold`, `blocked`, else `free`).
- Bot properties: `GET` returns stored ids or all active property ids when none stored; `PUT` replaces.
- Errors map to HTTP the same way commerce maps `LodgingError` (find the exception filter / mapping used for `LodgingError` in commerce, e.g. `common/http/domain-error.filter.ts`; add `NIGHTS_TAKEN`→409 with `details`, `STALE_VERSION`→409).

- [ ] **Step 1:** Integration cases in `lodging-v2.integration.spec.ts` through HTTP (copy the app bootstrap of `test/lodging.integration.spec.ts`): retail workspace gets 404 on `GET /lodging/properties`; create whole property → 1 unit; PUT rates missing Sunday → 400; PUT rates ok; overlapping override → 400; analyst role cannot POST (403); sell-mode change with a future booking → 409 (insert the booking via store).
- [ ] **Step 2–4:** FAIL → implement → PASS. Also update `apps/backend/test/http.spec.ts` expectations only if it enumerates routes explicitly (it should pick up `allRoutes`).
- [ ] **Step 5:** Commit `feat(lodging): properties, rooms, rates and overrides API (T-160)`.

---

### Task 6: Booking, calendar, availability, quote services + controllers

**Files:** `application/booking.service.ts`, `application/calendar.service.ts`, `interface/http/bookings.controller.ts`, `interface/http/calendar.controller.ts`, `api/lodging.events.ts`.

**Behaviour (every method starts with `assertHotel`, then `store.run` → `tx.expireOverdueHolds(now)` and publishes `lodging.booking.expired.v1` for each):**
- `quote(input)`: load property/units/rates, `resolveUnits`, `quoteStay`, `takenBy` = distinct codes from `takenNights(resolvedUnits, checkIn, checkOut)`.
- `create(req, actorId)`: idempotency exactly like `commerce/application/lodging.service.ts#create` (advisory lock on `clientRequestId`, sha256 fingerprint, replay or 409). Property must be `active`. Resolve units; quote (stay only). `status` `hold` → `holdExpiresAt = now + settings.holdMinutes`. Totals: `manualTotalSell ?? quote.totalSell` + `adjustment` (null when both null); `totalCost = quote.totalCost`. Confirmed/hold with `missing_rate` and no `manualTotalSell` → 400 "enter a price". `code = nextBookingCode()`, insert booking + `lodging_booking_units`, `takeNights(units, nights)`. Block: no party/money, status `active`. Audit + event `lodging.booking.created.v1` `{bookingId, code, propertyId, status, checkIn, checkOut, source}` (no guest PII in events).
- `update(id, req)`: version check; editable only `hold`/`confirmed` (all fields) and `checked_in` (only `checkOut`, must stay > checkIn); recompute units/nights/quote; `releaseNights` then `takeNights` in the same tx (a conflict rolls everything back); audit with previous `{checkIn, checkOut, unitIds, totalSell}`.
- `changeStatus(id, req)`: `nextStatus(kind, status, action, localToday(now), checkIn)`; `extend_hold` sets `holdExpiresAt = now + (req.holdMinutes ?? settings.holdMinutes)`; leaving to `cancelled`/`expired`/`no_show`/`removed` → `releaseNights`; `confirm` clears `holdExpiresAt`; events `.confirmed/.cancelled/.checked_in/.checked_out.v1`; cancel stores `reason` in audit.
- `list(query)`: views — `today`: `check_in = today OR check_out = today` with statuses confirmed/checked_in/checked_out; `holds`: status hold ordered by `hold_expires_at`; `upcoming`: occupying stay statuses with `check_out >= today` ordered by `check_in`; `all`: everything newest first; `q` matches code/guest name/phone (ILIKE); `conversationId` filter. Paginate 100 (+1 probe) like the T-155 list.
- `get(id)` → `BookingDetail` with `history`.
- `calendar(query)`: `from < to`, ≤ 62 nights else 400. For each active property (or `propertyIds`): rows = whole unit (whole mode) or active rooms (rooms mode); `prices` per night via `priceNight` (rooms: per room; `wholePrices`: whole rule or room sum, null if any missing); `segments` from `bookingsInRange`, clipped to the range, one segment per (booking, unit). Properties ordered by `sortOrder, code`.
- `availability(req)`: for each active property: whole option (always) and, for rooms mode, a "free rooms" option = all rooms free for every night (greedy: take free rooms ordered by capacity desc until party fits; `fits=false` if all free rooms don't fit). An option is returned only when its units are free for all nights. `fits` = quote has no `over_max`/`over_standard`. Sort: fits first, then `totalSell` asc (nulls last).
- `settings` get/patch (`catalog.manage` for patch).

- [ ] **Step 1:** Integration cases: create hold → nights taken, `GET /lodging/calendar` shows a segment with `holdExpiresAt`; second hold same nights → 409 with `details.codes = ['BK-0001']`; whole booking on a rooms property blocks a room booking and vice versa; idempotent replay returns the same booking, different payload with the same key → 409; hold whose expiry is set in the past (update the row directly) disappears from the calendar on next GET and its status is `expired`; confirm → check_in before the date → 409; cancel releases nights so a new hold succeeds; update dates moves nights atomically (conflict leaves the old nights intact); availability for 20 adults returns A17-like whole property with total; calendar range 63 nights → 400.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(lodging): bookings, holds, calendar and availability (T-160)`.

---

### Task 7: Facade, bot catalog and AI wiring

**Files:** `api/lodging.facade.ts` (`LODGING_FACADE`, `LodgingFacade { listBotPropertyIds(ws, botId): Promise<string[]> }`), `api/index.ts` (export `LODGING_FACADE`, `LODGING_CATALOG_FACADE`, types, events), `application/bot-catalog.ts` (class `LodgingBotCatalog implements CatalogFacade` from `../../commerce/api/index.js`? — NO: tier rule: `lodging` must not depend on `commerce`. Instead define the class against the structural type: copy the `CatalogFacade` method signatures into `lodging/api/lodging.facade.ts` as `LodgingCatalogFacade` returning `ProductDto[]` from `@agent-sales/contracts`; TypeScript structural typing lets `ai` use it where a `CatalogFacade` is expected). Modify `apps/backend/src/modules/ai/ai.module.ts` (import `LodgingModule`), `ai/application/playground.service.ts` (inject `@Inject(LODGING_CATALOG_FACADE) @Optional() lodgingCatalog`; when `bot.industry === 'hotel'` use it instead of `this.catalog` everywhere the catalog is used, including where it is passed to `catalog-tools`), `PROMPT_LODGING` → `{ name: 'sales-agent', version: 17 }`, `packages/ai-core/prompts/sales-agent@17.md`, `docs/ARCHITECTURE.md` §3 (add `lodging` to tier 2; `ai` depends on `lodging`).

Mapping property → `ProductDto` (fill every required ProductDto field; inspect `ProductDto` in `packages/contracts/src/commerce/commerce.schema.ts`): `id` = property id, `name` = `${code} – ${name}`, `description`, `status 'active'`, price fields = minimum weekday whole price (or min room price), images = first 5 gallery urls, `accommodation` = `AccommodationDetails` with `rentalType` (`entire_property` | `rooms`), `bedrooms` = layout length (≥1; for rooms mode = rooms count), `roomLayout` from layout (or rooms), `rateBasis 'night'`, `rates` = whole-target weekday rules `{days, amount: sell}` (rooms mode without whole rules: the cheapest room's), `units`, `overrides` (future ones only, max 20), `surcharges`, `code`, policies mapped back (`checkInOut` = `checkInTime/checkOutTime`, `depositPolicy`, `cancellationPolicy`, `extraGuestPolicy` = '' , `holidayPolicy` = '', `notes` = `policies.houseRules + other`), `gallery`. Never put cost prices in the bot view.

Search: `searchBotCatalog` filters active properties in the bot's selection; `query` matched accent-insensitively against code/name/area/amenities (reuse a normalizer from `@agent-sales/shared` if one exists — grep `removeDiacritics|normalizeVi`; else implement NFD strip in the lodging application layer); `maxPriceVnd` against min price; `inStockOnly` ignored.

Prompt `sales-agent@17.md` = copy of `@16` with the lodging bullets changed: rates are per night (`rateBasis night`) and may be quoted exactly for a listed weekday or dated override; the model still must not multiply/sum nights itself (use the calculator tool when present in the tool list; otherwise give per-night prices); `rentalType rooms` means rooms are rented separately and the whole place can be rented too; availability is still unknown to the bot in this version: never claim a night is free or held.

- [ ] **Step 1:** Unit test `application/bot-catalog.spec.ts`: A17-shaped property maps to a `ProductDto` that `ProductDto.parse` accepts, `accommodation.rentalType === 'entire_property'`, rates cover 7 days, no field contains a cost value; bot selection respected; search "a17" and "san golf" find it.
- [ ] **Step 2:** Update `ai/__tests__/playground.spec.ts` (or the closest test that builds a hotel bot) so a hotel bot reads from the lodging catalog fake, and the prompt version is 17.
- [ ] **Step 3:** Implement; run `pnpm --filter @agent-sales/backend exec vitest run src/modules/ai src/modules/lodging` → PASS; `pnpm arch` → PASS.
- [ ] **Step 4:** Run lodging evals offline: `pnpm --filter @agent-sales/backend exec vitest run ai/__tests__/evals.spec.ts`; update `apps/backend/src/modules/ai/evals` lodging fixtures to the new mapping if they build accommodation products. Live eval group `lodging-a17` is run in Task 10.
- [ ] **Step 5:** Commit `feat(ai): hotel bots read properties from the lodging module (T-160)`.

---

### Task 8: Web foundation — API hooks, navigation, i18n, redirects

**Files:** `apps/web/src/features/lodging/api/{properties,bookings,calendar,settings}.ts` (TanStack Query hooks using `api()` from `@/lib/api-client` and `useWorkspaceId`, query keys `['ws', ws, 'lodging', …]`; mutations invalidate `['ws', ws, 'lodging']`), `components/layout/app-sidebar.tsx` (`LODGING` = Lịch `/app/calendar` icon `CalendarDays`, Booking `/app/bookings` icon `ClipboardList`, Căn `/app/properties` icon `House`; nav keys `nav.calendar`, `nav.bookings`, `nav.properties`), `routes/app/accommodations.tsx` and `routes/app/stays.tsx` → `beforeLoad: () => { throw redirect({ to: '/app/properties' | '/app/bookings' }) }`, new route files with the hotel guard copied from `routes/app/stays.tsx` (extract it into `features/lodging/components/hotel-only.tsx` and reuse), i18n strings in the existing catalog pattern (inspect `packages/i18n/src/vi.ts` + `messages/vi/*.json`; add a `lodging2`-free, clean `lodging` namespace — reuse the existing `lodging` keys where they still fit, remove keys only used by deleted components), `features/bot/components/training-nav.tsx` (hotel label key `training.nav.properties` = "Căn & phòng").

Also delete the T-155 web components that no route uses any more (`accommodation-list.tsx`, `accommodation-form.tsx`, `stay-requests-page.tsx`, `stay-request-form.tsx`, `lodging-gallery-editor.tsx` — move the gallery editor to `features/lodging/components/gallery-editor.tsx` if reused), `features/commerce/api/lodging.ts`, and their tests, after checking `inbox-sales-panel.tsx` and `products/*` routes no longer import them (Task 9/10 replace those usages; do the deletion at the end of Task 10 if still referenced).

- [ ] **Step 1:** Update `components/layout/app-sidebar.test.tsx`: hotel shows Lịch/Booking/Căn and no "Sản phẩm"/"Đơn hàng"; retail unchanged.
- [ ] **Step 2–4:** FAIL → implement → `pnpm --filter @agent-sales/web exec vitest run src/components/layout` PASS; `pnpm --filter @agent-sales/web typecheck`.
- [ ] **Step 5:** Commit `feat(web): lodging navigation, hooks and redirects (T-160)`.

---

### Task 9: Web — Lịch (calendar) and the booking sheet

**Files:** `features/lodging/components/calendar-page.tsx`, `calendar-grid.tsx`, `calendar-toolbar.tsx`, `find-availability-bar.tsx`, `booking-sheet.tsx` (create + view/edit, shared with Task 10), `booking-status-badge.tsx`, `quote-breakdown.tsx`, `party-input.tsx`, `hooks/use-calendar-selection.ts`, `lib/format.ts` (`formatShortVnd(12000000) → '12tr'`, `formatVnd`, weekday labels via i18n), route `routes/app/calendar.tsx`. Tests next to components (`*.test.tsx`, Testing Library + msw handlers in `apps/web/src/testing`).

**UI contract (spec §5.1):**
- Toolbar: prev/today/next, range toggle 14/31 nights (`from` = today or the navigated start), area `Select`, switch "Chỉ căn còn trống".
- Find bar: check-in/check-out date inputs, adults number, children with ages (`party-input`), "Tìm" → `POST /lodging/availability`; fitting rows get `data-fit="true"` + accent ring and an inline "Giữ chỗ · 27.000.000đ" button that opens the sheet prefilled; non-fitting rows `opacity-50`; "Xoá tìm" resets.
- Grid: CSS grid inside `overflow-auto` container with sticky header row and first column; columns `minmax(56px,1fr)`; header cell = weekday short + day/month, weekend + override label shading (`bg-muted`), occupancy row ("Lấp đầy 85%"); property row (click toggles expand for rooms mode, `aria-expanded`); room rows indented. Empty cell = `<button>` with price text (`formatShortVnd`) and `aria-label` "A17, Thứ Sáu 06/11, trống, 13.000.000đ". Segments absolutely positioned within the row by start/end column; text `guestName · code` or block reason; status classes from `booking-status-badge` (hold: `bg-[repeating-linear-gradient(...)]` via a token-based utility class added to `apps/web/src/styles` if needed — colours from tokens only; confirmed solid primary-muted; checked_in solid + `LogIn` icon; checked_out muted; block hatched muted-foreground + `Lock` icon) and visible status text.
- Selection: click empty cell = start, click second cell on the same property (later date) = end (exclusive end = clicked night + 1); shift+click or drag between cells works; Esc clears; multiple rooms of one `rooms` property can be added with ctrl/cmd-click on room rows. Selection opens `booking-sheet` (shadcn `Sheet` side right) in create mode with tabs Giữ chỗ / Đặt luôn / Khoá lịch.
- Keyboard: grid `role="grid"`, rows `role="row"`, cells `role="gridcell"` containing the button; arrow keys move focus (roving tabindex), Enter selects.
- Booking sheet create: dates, unit chips, party, guest name/phone, source select (default `phone`), note, live quote (`POST /lodging/quote` debounced 300 ms) via `quote-breakdown` (nights table with weekday, label, sell; surcharges; adjustment input with reason; total), warnings as `Alert`s ("Chưa có giá cho đêm 07/11 — nhập giá thủ công", "Vượt tiêu chuẩn 24 người lớn + 8 trẻ"), conflict list from `takenBy`; submit with a stable `clientRequestId` (`crypto.randomUUID()` kept in state until success); 409 `NIGHTS_TAKEN` shows the codes and refetches the calendar.
- Booking sheet view: header code + status badge + property; action buttons from status (map: hold → Xác nhận, Gia hạn giữ, Huỷ; confirmed → Nhận phòng (disabled before check-in date with tooltip), Huỷ, Không đến; checked_in → Trả phòng; block active → Mở khoá); cancel asks a reason in an `AlertDialog`; edit mode for allowed fields re-quotes; conversation link `/app/inbox?conversation=<id>` (check the inbox route's search param name); history list.
- Mobile < 768 px (`useIsMobile` hook if present): property list, each with a month grid of 7 columns showing nights as free/taken squares with legend + "Tạo booking".
- Loading: skeleton grid; error: `Alert` + retry; empty (no properties): "Chưa có căn nào" + button to `/app/properties`.

- [ ] **Step 1:** Tests: renders A17 row with `12tr` price on a Monday and a segment "Anh Nam · BK-0001" with text "Đã đặt"; clicking two cells opens the sheet with check-in/out = first night / last night + 1; submit posts `CreateBookingRequest` with `status: 'hold'`; 409 shows "BK-0001"; find bar highlights a fitting row and dims others; hold segment shows "Giữ chỗ" text (not colour only); keyboard ArrowRight moves focus.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm --filter @agent-sales/web exec vitest run src/features/lodging`).
- [ ] **Step 5:** Commit `feat(web): lodging calendar with holds, blocks and find-availability (T-160)`.

---

### Task 10: Web — Booking list, Căn pages, inbox panel, bot training

**Files:** `features/lodging/components/bookings-page.tsx` (tabs today/holds/upcoming/all, shadcn `Table`, filters, search, pagination, row → `booking-sheet`), `properties-page.tsx` (card grid: cover image, code+name, area, sell mode badge, "24 NL + 8 TE", today state badge; "Thêm căn" dialog: code, name, sell mode, standard), `property-editor.tsx` with tabs `info-tab.tsx`, `rooms-tab.tsx` (rooms mode only; table editor), `rates-tab.tsx` (weekday matrix: rows = Whole/each room, columns T2..CN with sell/cost inputs, "Áp cho T2–T5" helper; overrides list with add/edit/delete dialog; surcharges; child age fields), `policies-tab.tsx`, `gallery-tab.tsx` (reuse the moved gallery editor + the existing product image upload hook if usable — check `features/commerce` image upload; otherwise URL + caption rows), routes `routes/app/bookings.tsx`, `routes/app/properties/index.tsx`, `routes/app/properties/$propertyId.tsx`; modify `routes/app/-components/inbox-sales-panel.tsx` (hotel: list the conversation's bookings via `GET /lodging/bookings?view=all&conversationId=…` and a "Tạo booking" button opening `booking-sheet` with guest name/phone/contactId/conversationId prefilled and no dates → date fields first), `routes/app/bots/$botId/products` route/component for hotel bots → `features/lodging/components/bot-properties.tsx` (switch per property, `PUT /lodging/bots/{botId}/properties`), and `routes/app/products/*` hotel branches → redirect to `/app/properties`.

Per-tab save with version (`409 STALE_VERSION` → toast "Dữ liệu đã thay đổi, tải lại" + refetch); unsaved-changes guard via the router `useBlocker` if the app already uses it (grep), else `beforeunload`.

- [ ] **Step 1:** Tests: bookings "Giữ chỗ" tab orders by expiry and marks overdue; properties grid shows "Nguyên căn"/"Theo phòng"; rates tab blocks save when a weekday is empty and shows the error near the field; inbox panel (hotel) shows "Tạo booking" and the conversation's bookings; bot training hotel page lists properties with switches and no "sản phẩm" text.
- [ ] **Step 2–4:** FAIL → implement → PASS. Delete the now-unused T-155 web files listed in Task 8 and their tests; `pnpm --filter @agent-sales/web typecheck lint`.
- [ ] **Step 5:** Commit `feat(web): bookings list, property editor, inbox and bot training for lodging (T-160)`.

---

### Task 11: Docs, ADR, sample data, full gate, dev deploy

**Files:** `docs/adr/ADR-018-lodging-module.md` (from `ADR-000-template.md`: context = spec §1; decision = own module, unit-night PK, lazy holds, Rapiz as source of truth, ADR-013 superseded in part; consequences = T-155 contract step pending, parts 2–4), `docs/adr/README.md` (row), `docs/adr/ADR-013-…md` (Status: "Superseded in part by ADR-018"), `docs/lodging.md` (rewrite to the new workflow + API table), `docs/05-data-model.md` (tables), `docs/17-multi-tenancy-and-verticals.md` §"Current lodging slice", `docs/ARCHITECTURE.md` (already in Task 7; verify), `apps/backend/src/modules/lodging/MODULE.md` (purpose, tables, public API, events, invariants: unit-night PK, lazy expiry, no PII in events; test commands), `docs/business/villas-a17-sample-data.json` (new shape: property + unit + rates), `docs/03-screens-and-routes.md` (hotel routes).

- [ ] **Step 1:** `pnpm check` in the worktree → all green (fix any lint/arch/type/test/build failure; never skip tests). Check `df -h /` first (disk was 90%).
- [ ] **Step 2:** Fresh-context review with the `review-pr` skill (subagent, `model: "opus"`); fix findings.
- [ ] **Step 3:** Dev deploy (memory: dev servers run from `/home/kenknight/Workspace/agent-sale`, DB `rapiz_acceptance` in container `razpi-t023-postgres` on 127.0.0.1:55434): `docker exec razpi-t023-postgres pg_dump -U postgres rapiz_acceptance > ~/Workspace/rapiz-backups/rapiz_acceptance-pre-0041.sql`; coordinate the checkout switch with the owner's other running work (the main checkout holds an uncommitted change on `feat/web-inbox-top-level-nav` — do not discard it); run the migration; restart api/agent/web; verify `/app/calendar` shows A17 and `ai_runs.prompt_version` = 17 after a test chat.
- [ ] **Step 4:** Live evals `pnpm --filter @agent-sales/backend eval --live --group lodging-a17` → record result.
- [ ] **Step 5:** Commit docs; push branch; open PR with the `open-pr` skill (body from template, attribution line).
