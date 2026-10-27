---
id: T-093
title: Scope business settings and bot defaults to the selected industry
status: backlog
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-27
branch:
pr:
parent:
---

## Context

Each business has one industry, and its settings should reflect that industry. A selected business must not silently inherit another business industry or account billing settings.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Scope business settings and bot defaults to the selected industry.

## Scope

- Bind existing industry-specific settings/navigation/defaults to the selected business and separate them from account-level packages.
- Prevent contradictory bot industry choices or explicitly migrate them under the approved model; document industry-change policy.
- Support currently implemented vertical settings with capability-aware empty states for missing functionality.

## Out of scope

- Implementing hotel, education or other vertical operational engines not already present.

## Acceptance criteria

- [ ] Switching between two industries changes the relevant settings context without modifying the other business.
- [ ] Account billing is visibly separate and a bot cannot silently contradict its business industry.
- [ ] Changing industry is either explicitly supported with a safe migration or blocked with a clear explanation.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = cofounder; B = user with Codex (updated user assignment). These are planning labels, not committed GitHub assignments.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078, T-079
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

To be filled by the implementer before coding. Scope and acceptance above are the planning contract.

## Log

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)

- 2026-10-26 — Lane B triage: Industry-scoped settings and defaults depend on the approved business context and industry-change policy in T-077/T-078/T-079. Existing settings remain intact.

- 2026-10-27 — Lane B owner set to @agent:claude by the user.
