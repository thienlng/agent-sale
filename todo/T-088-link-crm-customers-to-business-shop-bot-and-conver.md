---
id: T-088
title: Link CRM customers to bots and conversations
status: backlog
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-28
branch:
pr:
parent:
---

## Context

CRM already supports profiles, filters, statuses and tags. The review asks for bot linkage and coherent navigation with inbox; full reference-product parity is not sufficiently specified.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Link CRM customers to bots and conversations.

## Scope

- Define customer identity/deduplication at the approved business boundary and model potentially multiple bot/channel relationships through conversations.
- Add bot CRM filters and bidirectional navigation between contact records and conversations.
- Synchronize shared profile/status/tag mutations and cache refresh; handle unassigned channels and reassignment history without duplicating customers.

## Out of scope

- Unspecified CRM reference parity, import/merge engine T-036, files T-037, advanced automation T-038.

## Acceptance criteria

- [ ] A customer who contacts two pages follows the approved deduplication policy and their authorized conversations are discoverable from CRM.
- [ ] Inbox-to-CRM and CRM-to-inbox navigation retain business scope; bot filters return the expected customers.
- [ ] No cross-business customer identity leak or unauthorized relation is possible; historical bot associations survive reassignment as specified.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 4–5 person-days (Meta conversations have no stored contact link yet) including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078, T-080
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

To be filled by the implementer before coding. Scope and acceptance above are the planning contract.

## Log

- 2026-10-28 — Replanned for lane A, now owned by @agent:claude (user decision, 2026-10-28). Product model agreed with the user: account → business (workspace) → bot → channels. **No separate shop entity**: the bot is the selling unit. The catalog is business-owned and each bot chooses which products it sells. Billable unit: an AI reply delivered to the customer, counted once across retries. When the allowance is exhausted, the bot stops and hands off to staff. Business switching lives in the avatar (account) menu. Code inventory and re-estimate: see the handoff's "Lane A replan" section.

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)
