---
id: T-089
title: Centralize customer tags and statuses in customer settings
status: review
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-29
branch: feat/T-124-integrate-lane-a3
pr:
parent:
---

## Context

Tags and customer statuses must have one configuration home and shared identities across CRM and inbox. Customer status must remain distinct from conversation open/resolved state.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Centralize customer tags and statuses in customer settings.

## Scope

- Use Customer settings as the canonical place to manage tag/status definitions; reuse existing CRM sources/statuses/tags capabilities.
- Have inbox and CRM consume identical definitions and mutation contracts; definitions are business-scoped (no shop entity, T-077).
- Migrate duplicate definitions using an explicit mapping, preserve assignments and redirect old settings links.

## Out of scope

- Fixing the separate live tag mutation defect T-090, creating a second tag storage system.

## Acceptance criteria

- [x] Create or rename a tag/status in Customer settings and see the same ID/name reflected in CRM and inbox after refresh.
- [x] Customer status is independent of conversation resolution and bot enabled state.
- [x] Archiving a definition preserves historical assignments; permissions and conflict behavior are covered.
- [x] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [x] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 1 person-day (tags are already shared by CRM and inbox; customer and conversation statuses are already separate).
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

Survey (2026-10-28): Customer settings (`/app/crm-settings`: statuses, sources, tags, distribution) is already the only place that defines tags and statuses. CRM, the inbox tag bar, the inbox customer panel and statistics all read `/crm/tags` and `/crm/statuses`; the inbox links to `/app/crm-settings/tags`. There is one tag table (`crm_tags`, assignments scoped `contact | conversation`) and customer status (`contacts.status_id`) is separate from `conversations.status` and the bot mode. No duplicate store exists, so no data migration or link redirect is needed. Remaining gaps:

1. Active sources/statuses could share a name (tags already could not: partial unique index). Add a service-level check (trimmed, case-insensitive) on create, rename and restore, answering 409 `CONFLICT` with `details.name`. No unique index: older workspaces may already hold duplicates, which stay valid until renamed or archived.
2. Statistics cached tag/status names under their own query keys, so a rename in settings did not refresh them. Put them under the CRM keys.
3. Web: show the duplicate-name conflict as a sentence; "shop" → "business" in the non-member error.
4. Integration test covering the acceptance criteria end to end (same id and new name in the inbox, conflicts, archive keeps assignments, status independent of resolve/bot mode, permissions, other business).

## Log

- 2026-10-28 — Implemented on `feat/T-089-crm-links-and-account-billing` (block A3). Duplicate active source/status names answer 409; statistics name lookups share the CRM query keys; web names the clash. New integration test in `inbox-v2.integration.spec.ts` and web unit test `crm-errors.test.ts`. Docs: crm `MODULE.md`, docs/05.

- 2026-10-28 — Replanned for lane A, now owned by @agent:claude (user decision, 2026-10-28). Product model agreed with the user: account → business (workspace) → bot → channels. **No separate shop entity**: the bot is the selling unit. The catalog is business-owned and each bot chooses which products it sells. Billable unit: an AI reply delivered to the customer, counted once across retries. When the allowance is exhausted, the bot stops and hands off to staff. Business switching lives in the avatar (account) menu. Code inventory and re-estimate: see the handoff's "Lane A replan" section.

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.
- 2026-10-29 — Rebuilt on main under T-124 (A3), on top of the A2 block (PR #84).

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)
