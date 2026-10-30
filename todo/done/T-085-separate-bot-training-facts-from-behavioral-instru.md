---
id: T-085
title: Separate bot training facts from behavioral instructions
status: done
type: feature
priority: P1
owner: "@agent:codex"
feature_ids: []
created: 2026-10-26
updated: 2026-10-28
branch: feat/T-090-lane-b-review
pr: 64
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

- [x] Users can identify where to enter opening hours/prices versus tone and response rules from the UI alone.
- [x] Existing facts/rules remain editable and effective after navigation changes; any moved data has explicit mapping.
- [x] UI text is available in vi/en and independent QA reviews representative examples.
- [x] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [x] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = cofounder; B = user with Codex (updated user assignment). These are planning labels, not committed GitHub assignments.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

1. Explain factual business information versus behavioral instructions with examples and links between the existing pages. Preserve T-070 rules and all stored data.
2. Make navigation and page headings unambiguous in vi/en, update training docs and validate links through browser regression.
3. Run existing training/rules tests and independent QA acceptance. No prompt, retrieval or migration changes.

Autonomous implementation authorized by the user on 2026-10-26. Account/business/shop contracts remain lane A responsibilities.

## Log

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../../docs/08-billing-quota-credit.md)

- 2026-10-26 — Added purpose/explanation/example panels and cross-links between existing facts and instructions pages; renamed navigation in vi/en without changing stored content, prompt precedence or retrieval. Rules tests now use the real router context. Full milestone gate/browser QA pending.

- 2026-10-26 — Ready for human review: full pnpm check passed (frontend 367, backend 973 tests), independent code QA approved and fresh-context browser QA accepted the implemented workflows. See docs/handoffs/2026-10-26-lane-b-qa.md for exact commands, evidence and mocked-API limits.

- 2026-10-27 — Closed by lane B (@agent:claude): all acceptance criteria were checked and the change landed on main in 1b983a7 (reviewed in PR #64, pushed to main without a squash merge).

- 2026-10-28 — Source audit confirms the existing delivered behavior and previously checked acceptance criteria. Tracking reconciled under T-117; final branch regression evidence is recorded in docs/handoffs/2026-10-28-lane-b-closeout.md.
