---
id: T-085
title: Separate bot training facts from behavioral instructions
status: backlog
type: feature
priority: P1
owner:
feature_ids: []
created: 2026-10-26
updated: 2026-10-26
branch:
pr:
parent:
---

## Context

Reviewers cannot clearly distinguish business information from instructions governing bot behavior. This overlaps the existing T-070 instruction-rule work.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Separate bot training facts from behavioral instructions.

## Scope

- Audit training sections and distinguish factual knowledge, products, FAQs and media from behavioral instructions with labels, examples and navigation.
- Preserve existing training data and rule precedence; coordinate contracts and screen ownership with T-070.
- Use business industry context for guidance without silently rewriting user-authored instructions.

## Out of scope

- Reimplementing T-070, changing retrieval or system prompt semantics without separate evaluation.

## Acceptance criteria

- [ ] Users can identify where to enter opening hours/prices versus tone and response rules from the UI alone.
- [ ] Existing facts/rules remain editable and effective after navigation changes; any moved data has explicit mapping.
- [ ] UI text is available in vi/en and a trainer reviews representative examples.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077
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
