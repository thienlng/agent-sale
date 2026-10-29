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
- [ ] Authenticate and verify TinyMind business, bot and channel.
- [ ] Privately back up affected configuration and audit old shoe content.
- [ ] Apply prepared content without duplicates through existing interfaces.
- [ ] Read back saved counts and verify representative playground answers.
- [ ] Verify buyer/owner flow and takeover on the chosen test channel.
- [ ] Record final verification and check results.

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

## Links

- [Prepared business data](../docs/business/tinymind-junisprouts-prefill.json)
- [Training workspace](../docs/training-workspace.md)
- https://junisprouts.com/ (checked 2026-10-29)
- https://junisprouts.com/pages/shipping-policy (checked 2026-10-29)
- https://junisprouts.com/pages/refund-policy (checked 2026-10-29)
