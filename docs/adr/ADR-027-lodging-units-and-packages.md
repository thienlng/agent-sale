# ADR-027: Lodging unit details and bedroom packages

- Status: Proposed
- Date: 2026-11-05
- Decision makers: thienlng (owner approval of the design in chat, 2026-11-05)

## Context

Two owner needs did not fit the lodging model of ADR-018:

1. **Bedroom packages.** Some villas are always rented whole to one party, but the owner opens only
   some bedrooms and prices by how many are open ("Aura Villa 6PN" sold as 6PN, 5PN or 4PN, with 4PN
   not sold on Saturdays). A night is taken by one booking whatever the package; the closed bedrooms
   are never sold to someone else. A target had one price per weekday and one standard party.
2. **Units with their own details.** A place can hold a main house and bungalows around it, each
   with its own price, view and photos. A room had only a name, beds and a capacity, so the bot
   could not tell one bungalow from another.

Spec: `docs/superpowers/specs/2026-11-05-lodging-units-and-packages-design.md` (T-193).

## Decision

1. **Packages are price variants of one rental target, not units.** New table `lodging_packages`
   (migration 0067): `property_id`, `unit_id` (null = the whole property, the convention of
   `lodging_rates.unit_id`), name, bedrooms, standard party, optional maximum, sort order. Rates
   (weekday and date-range) and booking units gain a nullable `package_id`. Occupancy is untouched:
   `lodging_unit_nights` and its primary key stay the only anti-double-booking rule, so a package
   can never cause a double booking.
2. **The full package carries the target.** The package with the most bedrooms (tie: the later sort
   order) must price every weekday; the others price each weekday at most once, and a missing
   weekday means "not sold". The calendar, the property list's `weekdaySell` and the bot's
   `rates` use the full package, so everything that reads one price per target keeps working.
   A target without packages works exactly as before; no backfill.
3. **The quote picks the package.** An explicit `packageIds` entry wins; otherwise, when the
   selection prices exactly one target and it has packages, the fewest-bedroom package that holds
   the party and prices every night, else the full package; in every other selection each target
   gets its full package. An explicit package missing a night gives `missing_rate` plus the
   warning `package_unavailable`. Availability options on a single package target list the other
   packages with their totals (`alternatives`).
4. **Packages and rates are written together.** `PUT rates` replaces packages, weekday rates and
   surcharges in one request validated as a whole; new packages are referenced by a client `key`.
   A missing package is deleted with its rates (cascade) and its booking units lose the link
   (`set null`). A kept package may not change its target. Stored package-less date-range prices
   of a target that gets packages move onto its full package in the same transaction.
5. **Unit details live on `lodging_units`.** Category, view, area, description, amenities, an
   optional maximum, and a gallery with cover in the ADR-026 folder shape and limits, written by
   `PUT units`. The bot catalog carries them; a unit's folders are album ids after the property's
   (index 20 on), so a unit folder never shifts a property album id. Surcharges stay per property.
6. **Bot.** Hotel bots use `sales-agent@21` (= @20 plus unit and package rules). `prepare_hold`
   takes optional `packages` by name; the draft stores the package ids (migration 0068,
   `lodging_bot_hold_drafts.package_ids`) and the confirm books exactly those.

## Options considered

1. **One unit per package sharing a calendar** (6PN, 5PN, 4PN as three units linked so that a
   booking of one blocks the others): needs a new "linked units" rule in `takeNights`, breaks the
   one-row-per-unit-night invariant of ADR-018 or multiplies night rows, and makes the calendar show
   three rows for one villa. Rejected: packages change the price, not what is occupied.
2. **Bedrooms as rooms of a rooms property** (sell 4 of 6 rooms as a whole rental): the closed rooms
   would look free and could be sold to another party, which the owner forbids, and the price per
   package is not a sum of room prices. Rejected.
3. **Per-weekday price tiers by party size on the target** (no package entity): cannot carry a
   package's own standard party, maximum and name, nor "4PN not sold on Saturday", and the staff
   and the bot have nothing to name. Rejected.
4. **A separate `lodging_unit_details` table**: a 1:1 join on every read for a handful of columns
   that are always read with the unit. Rejected.
5. **Room types with a quantity** (one "Bungalow" type × 8): automatic room assignment and a new
   inventory model for a case the owner enters by hand today. Out of scope.

## Consequences

- Positive: the owner enters the sheet as it is; packages never risk a double booking; existing
  properties and code paths that read one price per target are unchanged; the bot can present and
  send media per unit and quote the package that fits.
- Negative: rate validation and the quote have a second shape (targets with packages); the web
  mirrors the server's package-target rules to decide which selects to show; deleting a package
  silently deletes its date-range prices (the editor warns first); a booking edit re-picks a kept
  package automatically when it stops fitting, without a warning to staff.
- Rollback: an earlier release would read several prices per weekday on a packaged target. Rolling
  back past T-193 needs the hand-run `packages/db/sql/rollback-0067-lodging-units-packages.sql`,
  which reverses 0067 and 0068 (full-package rates become plain rates, the others are deleted; unit
  details, unit galleries and packages are lost); both `schema_migrations` rows must be deleted
  before redeploying (docs/runbooks/deploy-vps.md).
- Follow-ups: per-unit surcharges or policies if asked; selling a unit's packages to different
  parties on the same night is explicitly not planned; a `sell: null` night in the quote contract
  instead of a 0 line with `missing_rate`.
