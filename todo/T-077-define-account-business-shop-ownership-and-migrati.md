---
id: T-077
title: Define account business ownership and migration contracts
status: backlog
type: spike
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

The review introduces an account-level portfolio and billing owner above businesses, each with one industry and multiple shops. Existing workspaces, membership and billing must be mapped explicitly before dependent changes.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Define account business ownership and migration contracts.

## Scope

- Write an ADR (Proposed until approved) that adds an account above businesses. The account is the commercial and billing owner. Workspace stays the business and its RLS boundary.
- Define account membership independently of business membership. Paying for a business never grants access to it.
- Make the bot the selling unit: business-owned catalog, per-bot product selection, and bot attribution of conversations and analytics facts that survives page reassignment.
- Define the backfill and rollback plan, the route and navigation map (switching in the avatar menu), and DTO/API examples.
- Inventory the current implementation. Resolve the pending decisions in the handoff, or record them explicitly.

## Out of scope

- Implementing migrations or changing runtime behavior.

## Acceptance criteria

- [ ] A fixture with two accounts, two industries, several bots per business and one member shared across businesses enumerates permitted and forbidden reads.
- [ ] The migration/backfill and rollback plan, account billing ownership, catalog scope and bot attribution rules are written down and approved by the owner before T-078 migrations land.
- [ ] Lists which existing ADRs and design docs (docs/05, docs/08, docs/17, docs/analytics.md) change, and how.
- [ ] `pnpm check` passes (docs-only change).

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: None; start independently.
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
