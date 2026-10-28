---
id: T-080
title: Let each bot sell a chosen part of the business catalog
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

A business can have several shops. The diagram suggests business-owned products available to its shops; this sharing rule remains a proposal pending T-077.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Let each bot sell a chosen part of the business catalog.

## Scope

- Products stay business-owned. A bot either sells the whole catalog (default, no behavior change for existing bots) or a selected list of products.
- AI catalog lookups (`CatalogFacade`) take the bot. Expose a reusable bot lookup for inbox, integrations and CRM filters.
- Bot settings UI to choose products. Newly created products follow the bot's mode. Absorbs lane B's T-110.

## Out of scope

- A shop entity, per-bot prices or stock, inventory engine, product variants backlog T-028.

## Acceptance criteria

- [ ] Two bots of one business sell different product subsets; each bot's AI only sees its own products; another business is unaffected.
- [ ] Archived products and removed selections keep historical orders intact; the default "all products" mode is unchanged for existing bots.
- [ ] Unit, integration (cross-tenant) and UI tests; `pnpm check` passes; docs and vi/en strings.

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 2.5 person-days.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078
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
