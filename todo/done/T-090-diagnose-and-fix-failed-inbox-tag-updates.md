---
id: T-090
title: Diagnose and fix failed inbox tag updates
status: done
type: bug
priority: P1
owner: "@agent:codex"
feature_ids: []
created: 2026-10-26
updated: 2026-10-27
branch: feat/T-090-lane-b-review
pr: 64
parent:
---

## Context

Supplied Image 1 shows a failed-tag-update toast. This confirms a user-visible failure but does not establish whether the cause is UI, permissions, API validation, version conflicts or runtime schema drift.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Diagnose and fix failed inbox tag updates.

## Scope

- Reproduce the reported add/remove tag flow on the running integration version and capture sanitized request/error metadata.
- Add a failing regression, fix the verified cause and preserve correct contact versus conversation tag scope.
- Handle stale version conflicts and failed optimistic updates; verify add/remove and persisted state in CRM where scope is shared.

## Out of scope

- Global inbox redesign, broad tag schema replacement; estimate assumes a localized defect.

## Acceptance criteria

- [x] Adding and removing a valid authorized tag succeeds and persists after reload; the same sequence no longer shows the reported error.
- [x] On validation, permission or network failure the UI retains accurate state and gives an actionable localized error.
- [x] Record the verified root cause and reproduction; if not reproducible, report evidence rather than marking the screenshot resolved.
- [x] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [x] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = cofounder; B = user with Codex (updated user assignment). These are planning labels, not committed GitHub assignments.
- Base estimate: 1 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: None; start independently.
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

1. Trace the existing inbox tag route, CRM assignment permission and optimistic mutation lifecycle; reproduce the failure using sanitized fixture data.
2. Add a failing regression for the verified defect, fix it without altering tag ownership or business scope, and prevent overlapping tag actions while pending.
3. Verify targeted backend/frontend regressions, then full checks and browser flows. Record runtime diagnostics without customer data or credentials.
4. Obtain independent agent QA review under the review-pr skill.

The user explicitly authorized autonomous lane B implementation while away, so no additional plan approval is pending. Work uses an isolated branch from integration/local-all because main lacks the reviewed runtime features; unrelated dirty worktrees are preserved.

## Log

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../../docs/08-billing-quota-credit.md)

- 2026-10-26 — Independent QA reproduced the contract mismatch read-only: Event requires event_name and Ticket requires subject; the inbox sent only tagId. VIP has no required fields and validates without values. No live customer records were changed.
- 2026-10-26 — Added a shared tag-values editor (extracted from CRM), conversation-scoped dialog lifecycle, values payload support and disabled busy quick actions. Targeted hook/tag-bar tests: 15 passed; attribute form tests: 4 passed. Further independent acceptance and full gate pending.

- 2026-10-26 — Ready for human review: full pnpm check passed (frontend 367, backend 973 tests), independent code QA approved and fresh-context browser QA accepted the implemented workflows. See docs/handoffs/2026-10-26-lane-b-qa.md for exact commands, evidence and mocked-API limits.

- 2026-10-27 — Closed by lane B (@agent:claude): all acceptance criteria were checked and the change landed on main in 1b983a7 (reviewed in PR #64, pushed to main without a squash merge).
