---
id: T-155
title: Complete the Villas business experience and seed the real A17 property
status: done
type: feature
priority: P1
owner: agent:codex
feature_ids: [VRT-01, VRT-04, BOT-07]
created: 2026-10-29
updated: 2026-10-30
branch: feat/T-155-villas-a17-business
pr: https://github.com/thienlng/agent-sale/pull/88
parent:
---

## Context

The owner requested a complete Villas/homestay business experience using real SKY VILLA A17 data from /home/kenknight/Pictures/villa_a17, including independent QA and acceptance. The selected business is Tam Dao Villas Central (hotel), with one active bot and its connected Facebook Page. Its catalog is empty and its bot display name is currently incorrect.

## Goal

Deliver and verify a useful one-property lodging workflow, sourced A17 training/photos and clear boundaries between an inquiry, a stay request and a confirmed reservation.

## Scope

- Audit the source info.md and 12 photos; privately back up existing selected-business data.
- Model an entire-property accommodation with room layout, adult/child capacity, amenities, source rate tiers and unconfirmed policies.
- Existing commerce-owned catalog integration and a separate stay-request workflow using dates and guest counts; no warehouse, stock, shipping or COD semantics for lodging.
- Explicitly scoped additive schema/contracts, application/domain/persistence/controller/UI work and industry-aware navigation; reuse existing module shapes and authorization.
- If persisted stay requests and accommodation metadata require an architecture decision, add an ADR under docs/adr and its index; this task explicitly authorizes that documentation.
- Source and seed content via tenant-authorized APIs; merchant contacts are business content, never generic fixtures/logs.
- Meaningful domain, authorization/tenant, UI and AI acceptance checks; independent fresh-context QA and a final report.

## Out of scope

- Unverified live room availability, external PMS/calendar integration, fabricated deposit/cancellation/surcharge policies.
- Actual customer sends, paid bookings/payments or pretending an inquiry reserved the villa.
- Generic multi-property/channel marketplace, new infrastructure or unrelated retail changes.
- Protected repository/tooling/CI configuration changes.

## Acceptance criteria

- [x] Exactly one whole-villa A17 accommodation, with correct 8-bedroom layout and capacity distinctions.
- [x] All 12 source photos inspected and available through tenant-scoped product/gallery/media references; S3 unavailable, documented dev-asset fallback.
- [x] Source weekday rates retained as 12/13/14 million VND, with explicit rate-basis uncertainty unless owner confirms.
- [x] Hotel owners can manage dates/guest counts and track stay requests without creating retail inventory/orders.
- [x] Requests cannot be represented as confirmed availability or payment; any confirmation flow has explicit staff verification and overlap safety.
- [x] A17 profile, FAQs, situations and quick replies answer actual source questions and defer unknown policies appropriately.
- [x] TinyMind data and retail behavior remain unchanged.
- [x] Meaningful tests, cross-tenant/permission cases, prompt evals when applicable and pnpm check pass.
- [x] Native Chrome acceptance plus independent QA review completed; unresolved limits documented.
- [x] Docs, task tracking, commits and remote delivery completed.

## Plan

1. Audit runtime/business data and source files; ask only for missing pricing/policy facts while proceeding with independent work.
2. Establish bounded lodging contracts and persistence within commerce, using the existing product master plus accommodation details and date-based stay requests.
3. Implement domain date/capacity/reference-price validation and safe request/confirmation semantics with tenant transactions and tests.
4. Build hotel-specific accommodation and stay-request UI/navigation, preserving retail routes and behavior.
5. Upload and seed the real A17 content through authenticated APIs; no fictitious stock, bookings or policies.
6. Verify API readback, tenant isolation, real-stack browser behavior and grounded AI scenarios; obtain fresh-context QA, fix findings and rerun relevant checks.
7. Record evidence/limits, run pnpm check, commit and push the reviewable result.

## Log

- 2026-10-29 — Created from the owner's explicit four-hour autonomous completion request and QA requirement. Source is one villa, not eight independently bookable rooms. Source rates omit a per-night unit and policies; requested clarification without blocking independent work.
- 2026-10-29 — Read current selected-business state: hotel industry, empty catalog, active sale_villas bot, connected Tam Dao Golf Villas - Central Page. Existing bot profile displayName is Em and needs correction. TinyMind work was pushed separately at 4cf9e66 on chore/T-153-tinymind-junisprouts-prefill.

- 2026-10-30 — Implemented additive migration0035/contracts/commerce lodging workflow, forcedRLS/compositeFK/GiST overlap exclusion, staff attestations, idempotency, pagination, hotel UI and prompt10. Seeded A17 via APIs with16FAQ/8situations/4quick replies/12photos; S3 upload503 uses established ignored dev assets. Source units/policies/availability remain unknown.
- 2026-10-30 — Independent QA initially found two P2 gaps (newest100 cap, gallery photo selection); both fixed and regression-tested. Final reviewer approval:26 backend+4UI tests pass, no blocking findings. Native Chrome Tùng A17 screen and browser reference quote verified. Actual seeded bot four grounding/photo probes pass; live lodging eval3/3 critical passes after correcting premature handoff. See docs/business/villas-a17-acceptance.md.

- 2026-10-30 — Ready for review: final pnpm check passed lint/architecture,22/22 typecheck tasks,19/19 test tasks and13/13 build tasks; backend78files/1268tests, web95files/608tests, contracts77tests. Initial gzip241.7KB stays within250KB budget. Final PostgreSQL lodging integration4/4 passed33.23s. Source scan found no credentials/booking-contact PII; git diff --check passed. Commit/push and PR deliver this completed implementation; maintainer review/ADR acceptance and CI remain separate gates.

- 2026-10-30 — Pushed c9d170a on feat/T-155-villas-a17-business and opened draft PR#88 while CI runs. Maintainer review remains required.

## Links

- docs/17-multi-tenancy-and-verticals.md
- docs/training-workspace.md
- docs/ARCHITECTURE.md
- Source folder: /home/kenknight/Pictures/villa_a17
