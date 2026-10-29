---
id: T-155
title: Complete the Villas business experience and seed the real A17 property
status: in-progress
type: feature
priority: P1
owner: agent:codex
feature_ids: [VRT-01, VRT-04, BOT-07]
created: 2026-10-29
updated: 2026-10-29
branch: feat/T-155-villas-a17-business
pr:
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

- [ ] Exactly one whole-villa A17 accommodation, with correct 8-bedroom layout and capacity distinctions.
- [ ] All 12 source photos inspected, uploaded under the selected tenant and available through product/gallery references.
- [ ] Source weekday rates retained as 12/13/14 million VND, with explicit rate-basis uncertainty unless owner confirms.
- [ ] Hotel owners can manage dates/guest counts and track stay requests without creating retail inventory/orders.
- [ ] Requests cannot be represented as confirmed availability or payment; any confirmation flow has explicit staff verification and overlap safety.
- [ ] A17 profile, FAQs, situations and quick replies answer actual source questions and defer unknown policies appropriately.
- [ ] TinyMind data and retail behavior remain unchanged.
- [ ] Meaningful tests, cross-tenant/permission cases, prompt evals when applicable and pnpm check pass.
- [ ] Native Chrome acceptance plus independent QA review completed; unresolved limits documented.
- [ ] Docs, task tracking, commits and remote delivery completed.

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

## Links

- docs/17-multi-tenancy-and-verticals.md
- docs/training-workspace.md
- docs/ARCHITECTURE.md
- Source folder: /home/kenknight/Pictures/villa_a17
