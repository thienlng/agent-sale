# ADR-017: An external PMS is the source of truth for linked catalog and customer data

- Status: Accepted
- Date: 2026-11-01
- Decision makers: thienlng (owner), Claude (author)

## Context

Many shops already run their sales on a point-of-sale / shop management system (PMS), most often KiotViet,
and ask whether Rapiz connects to it. Their products, prices, stock per branch and customers live there, and
staff keep editing them there. Rapiz's bot needs the same data to answer correctly, and orders it closes
should land in the PMS.

Until now Rapiz owned all of its data: `commerce` held the catalog and stock, `crm` held customers, and
background work ran as Postgres-lease queues and ticks (no BullMQ consumers exist yet, ADR-003 is still
"Proposed").

## Decision

1. A new module **`integration`** (tier 3, "flows") connects a workspace to an external PMS. KiotViet is the
   first provider. It depends on the `commerce` and `crm` facades; nothing depends on it.
2. For **linked** records the PMS is the **source of truth**. `commerce` and `crm` store link columns
   (`external_source`, `external_id`) on products, variants, orders and contacts. Linked fields are
   read-only in Rapiz (409 `EXTERNAL_SOURCE`); Rapiz-only fields (bot visibility, bot instructions, bot
   selection) stay editable. Records without a link remain Rapiz-owned.
3. The integration writes only through new facade methods on `commerce` (`CATALOG_SYNC_FACADE`, order push
   methods) and `crm` (external contact methods). It never touches their tables.
4. Data is mirrored, not proxied: the bot keeps reading the Rapiz catalog (fast trigram search, no PMS rate
   limit in the reply path). Freshness comes from PMS webhooks plus a 10-minute reconcile.
5. Background work follows the existing lease pattern: an `integration_jobs` table claimed with
   `FOR UPDATE SKIP LOCKED`, driven by a tick in the `worker` entry. No BullMQ is introduced.
6. PMS webhooks enter through `apps/webhook` on a per-connection unguessable path, are stored raw, and are
   verified (HMAC) by the worker, which holds the sealed per-connection secret.
7. Disconnecting keeps all data and clears the links, so products and customers become Rapiz-owned again.

## Options considered

- **Live proxy** (the bot calls KiotViet at reply time): always fresh, but 5 000 requests/hour per store, no
  fuzzy search, and a PMS outage would break replies. Rejected.
- **Two-way sync** (edit anywhere): conflict resolution and overwrite risk for little gain; shops already
  edit in their PMS. Rejected by the owner.
- **BullMQ for sync jobs**: would be the first BullMQ consumer and needs Redis wiring in every environment;
  the lease pattern already runs in production. Deferred to ADR-003.

## Consequences

- `commerce` gains an order stock state `external`: once an order is in the PMS, Rapiz moves no stock for it.
- Catalog edits for linked products must be made in the PMS; the UI says so where the fields are.
- Adding Sapo/Haravan later means a new provider client and mapping inside `integration`, not new facades.
- Stock shown to the bot can lag by up to the webhook delay (seconds) or, if a webhook is lost, 10 minutes.
