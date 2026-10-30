# ADR-013: Whole-property lodging catalog and staff-confirmed stay requests

- Status: Proposed
- Date: 2026-10-29
- Decision makers: thienlng

## Context

T-155 uses real SKY VILLA A17 data: one entire villa with eight bedrooms, weekday reference prices, guest allowances and twelve photos. Retail stock, variant quantities, shipping and COD do not represent a stay. The source does not establish a nightly rate basis, booking calendar, deposits or cancellation terms. [docs/17](../17-multi-tenancy-and-verticals.md) anticipates generic resources/appointments, but those modules are not implemented.

## Decision

Keep the existing commerce product master and add optional validated accommodation metadata. An accommodation is a whole property; bedrooms and weekday prices are descriptive configuration, not independently purchasable variants. Add a commerce-owned bounded stay-request object with local dates, party, immutable reference-quote snapshot, idempotency key and optimistic version. Requests do not reserve dates or debit money. Staff confirmation requires explicit verification of actual availability, guest/terms approval and an agreed total. Confirmed occupancy uses half-open date ranges and a tenant/property/date exclusion constraint, with product locking and transactional audit records. Cancellation releases local occupancy only. The local calendar can establish a conflict but never guarantees external physical availability. Source rates without a confirmed basis have no computed stay total. Lodging cannot enter retail inventory or retail order lines.

This is an incremental implementation of the lodging slice of VRT, not a generic appointment/PMS module or an external calendar integration. It adds no runtime process, external dependency or payment ledger flow. Future generic resources/appointments must migrate these tenant-owned records without silently losing confirmations.

## Options considered

1. Use retail variants for weekdays and warehouse stock for availability: rejected because one villa can be booked on different dates, rate tiers are not separate inventory, and retail shipping/cancellation semantics would misrepresent a stay.
2. Build generic resources/availability/appointments and PMS integrations first: deferred because the supplied case is one entire property and contains no authoritative external calendar. The wider generic model remains the target design.
3. Store only FAQs and collect a telephone number: insufficient for the requested business workflow because owners cannot persist/review stay dates, parties or conflicting confirmed requests.

## Consequences

- Hotel UI exposes accommodations and stay requests; retail navigation and contracts remain backward compatible.
- Existing product rows have null accommodation metadata. New metadata cannot convert existing goods or be stripped from an accommodation.
- All stay writes and audit rows share a forced-RLS tenant transaction. Composite foreign keys prevent cross-tenant product references. Confirmed overlaps are rejected even under concurrent requests.
- No policy, rate unit, deposit or availability is invented from missing source data. Reference quotes are estimates, and explicit staff pricing is distinct from a collected payment.
- Twelve gallery images are supported in accommodation metadata/media; the five-image retail product limit is preserved.
- External calendar synchronization, rescheduling, payment/deposit accounting, workflow conversion events and a generic appointment migration are follow-ups rather than silently claimed capabilities.
