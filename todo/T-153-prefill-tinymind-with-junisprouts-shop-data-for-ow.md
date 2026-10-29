---
id: T-153
title: Prefill TinyMind with JuniSprouts shop data for owner buyer testing
status: blocked
type: chore
priority: P1
owner: agent:codex
feature_ids: [BOT-07, ORD-01]
created: 2026-10-29
updated: 2026-10-29
branch: chore/T-153-tinymind-junisprouts-prefill
pr:
parent:
---

## Context

The owner requested a TinyMind prefill using their public JuniSprouts store for buyer/owner role-play. T-053 records previous shoe demo content that must be audited before replacement.

## Goal

Populate the verified TinyMind bot with sourced toy-shop data and verify representative buyer/owner flows.

## Scope

- Public catalog, images, profile, FAQ, situations and quick replies.
- Existing authenticated, tenant-scoped application interfaces.
- Explicit source conflicts and unknown fields.

## Out of scope

- Application code, schema, API, prompt or tooling changes.
- Other businesses, channel assignments, existing conversations or contacts.
- Invented inventory, policies or contact details; actual purchases or customer messages.

## Acceptance criteria

- [x] Prepare all 59 products / 63 variants with images, direct VND prices and source links.
- [x] Prepare profile, 12 FAQ, 8 situations and 4 quick replies.
- [x] Document source conflicts, unknown inventory and US-only shipping.
- [x] Authenticate and verify TinyMind business, bot and channel.
- [x] Privately back up affected configuration and audit old shoe content.
- [x] Apply prepared content without duplicates through existing interfaces.
- [x] Read back saved counts and verify representative playground answers.
- [ ] Verify live buyer/owner delivery and takeover after Facebook reauthentication. Playground purchase intent and handoff outcome passed.
- [x] Record final verification and check results.

## Plan

1. Read mandatory rules and training/runtime contracts; run onboarding verification.
2. Fetch public catalog and every detail page; prepare business data and source discrepancies.
3. Obtain an authenticated session, verify scope and inspect existing records.
4. Save a private pre-change snapshot; reconcile old demo content reversibly.
5. Apply content without inventing inventory; resolve order-testing prerequisites with owner.
6. Read back data and test grounded answers, then provide role-play instructions.

No application code changes are planned. Validate payloads with existing contracts. Never populate unknown fields merely to satisfy readiness indicators.

## Log

- 2026-10-29 — Created from owner request. Mandatory onboarding reads completed and setup verification launched. GitHub CLI unavailable; initial working tree clean, main matched origin/main.
- 2026-10-29 — Dashboard redirects to login. Requested owner/test-manager access; no application data has been changed. Blocked on authenticated session.
- 2026-10-29 — Fetched 59 products, 63 variants and all 59 detail pages. Browser storefront and cart report VND; rendered prices agree with catalog JSON. Search crawler showed USD; no manual exchange rate used.
- 2026-10-29 — Prepared docs/business/tinymind-junisprouts-prefill.json. Actual inventory counts remain null; source availability is not a count. Two products marked unavailable.
- 2026-10-29 — Dedicated return policy says 60 days; product accordions say 90. Product-card ages sometimes conflict with detailed recommendations. Prepared data prioritizes dedicated policy and detailed safety guidance.
- 2026-10-29 — Hotline, maps link, payment methods and standalone warranty unverified. Mailing address is not confirmed as a pickup point. Shipping remains US-only even when storefront shows VND.
- 2026-10-29 — Setup verification completed successfully, including pnpm check (13/13 Turbo tasks). Existing Zod contracts validated the profile, 59 catalog payloads, 63 unique SKUs, 12 FAQ and 12 training items. Data and tracking files formatted with Prettier. These checks validate prepared data only; no live TinyMind behavior has been tested.

- 2026-10-29 — Applied and read back 59 products / 63 variants, 12 FAQ, 8 situations, 4 quick replies and sourced profiles. Archived nine shoe products and removed old shoe training with restore history. No actual inventory adjustment, order or customer message was made.
- 2026-10-29 — Native Chrome profile Tùng verified profile, catalog, personality, quick replies and expired channel; one UI playground question returned the correct price and age caution. Fixed imported quick-reply shortcuts to valid non-space keys after the UI check. Ten distinct API playground cases passed after sequential retries; four concurrent attempts received 503 while the UI generation was active.
- 2026-10-29 — Verified source footer payment icons and updated the payment field. Source logo PNG is 600 by 300 and does not meet the square-logo contract. Public source conflicts and all missing fields are documented in the report.

- 2026-10-29 — Owner supplied an authorized account and requested API import followed by verification in their open Chrome profile Tùng. Authenticated owner membership of TinyMind and assigned sale_tinymind bot verified. Private pre-change snapshot saved outside the repository. Facebook connection reports reauth_required.
- 2026-10-29 — Final pnpm check passed (13/13 Turbo tasks; all cached). Initial attempts were blocked by generated browser script/snapshot artifacts; moved those artifacts outside the source tree and reran the unchanged gate. No application code changed.

## Current delivery

API import and native Chrome profile Tùng verification are complete. Live Facebook delivery remains blocked by the existing reauth_required connection. Inventory quantities, hotline and Maps are unverified; no synthetic values were applied. See [the verification report](../docs/business/tinymind-prefill-report.md).

## Links

- [Prepared business data](../docs/business/tinymind-junisprouts-prefill.json)
- [Training workspace](../docs/training-workspace.md)
- https://junisprouts.com/ (checked 2026-10-29)
- https://junisprouts.com/pages/shipping-policy (checked 2026-10-29)
- https://junisprouts.com/pages/refund-policy (checked 2026-10-29)
