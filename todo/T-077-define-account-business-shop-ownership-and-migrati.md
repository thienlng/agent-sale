---
id: T-077
title: Define account business ownership and migration contracts
status: review
type: spike
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-28
branch: feat/T-124-integrate-lane-a1
pr: 82
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

- [x] A fixture with two accounts, two industries, several bots per business and one member shared across businesses enumerates permitted and forbidden reads.
- [ ] The migration/backfill and rollback plan, account billing ownership, catalog scope and bot attribution rules are written down and approved by the owner before T-078 migrations land.
- [x] Lists which existing ADRs and design docs (docs/05, docs/08, docs/17, docs/analytics.md) change, and how.
- [x] `pnpm check` passes (docs-only change).

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: None; start independently.
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

1. Inventory the current tenancy, billing, bot/channel, catalog and CRM code (done 2026-10-28; summary in the handoff's "Lane A replan").
2. Write ADR-012 (Proposed): entities, access, signup and creation, bot as the selling unit, billing ownership, routes, contracts, backfill and rollback, access fixture, docs to update, open questions.
3. Owner review: Tùng and the maintainer accept the ADR or ask for changes. T-078 migrations wait for this approval.
4. On approval: mark ADR-012 Accepted and tick the approval criterion. Docs listed under "Consequences" are updated by the implementing tasks (T-078, T-079, T-080, T-091), not here.

## Log

- 2026-10-28 — In review together with T-078 on the same branch. The maintainer asked to go ahead with T-078 before formally approving ADR-012. Owner approval of ADR-012 is therefore still open (unchecked criterion) and happens in this PR's review; the migrations land only with that approval.
- 2026-10-28 — Replanned for lane A, now owned by @agent:claude (user decision, 2026-10-28). Product model agreed with the user: account → business (workspace) → bot → channels. **No separate shop entity**: the bot is the selling unit. The catalog is business-owned and each bot chooses which products it sells. Billable unit: an AI reply delivered to the customer, counted once across retries. When the allowance is exhausted, the bot stops and hands off to staff. Business switching lives in the avatar (account) menu. Code inventory and re-estimate: see the handoff's "Lane A replan" section.
- 2026-10-28 — ADR-012 drafted (Proposed): accounts as global tables owned by a new `account` module, business access unchanged, composite channel → bot foreign key, bot attribution of events and facts at event time, per-bot catalog selection, account billing (T-091), route map, backfill/rollback, access fixture (§9). Four open questions for the product owner listed in the ADR; none blocks T-078. Waiting for owner approval before T-078 migrations.

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)
