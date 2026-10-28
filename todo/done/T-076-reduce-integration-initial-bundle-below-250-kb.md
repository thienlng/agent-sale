---
id: T-076
title: Reduce integration initial bundle below 250 KB
status: done
type: chore
priority: P1
owner: "@agent:codex"
created: 2026-10-26
updated: 2026-10-28
branch: feat/T-090-lane-b-review
pr: 64
---

## Context

During T-075 font verification, pnpm check passed lint, architecture, typecheck and all tests, but the integration web build exceeded the initial bundle budget: 257.0 KB gzip versus 250 KB. Vite compilation itself succeeded. The primary checkout passed its full gate. The integration checkout includes additional application features; the origin of the extra bundle size has not been isolated.

## Goal

Restore the existing initial-load budget without weakening its check.

## Scope / Out of scope

Inspect initial imports and code splitting in the integration web app. Preserve functionality and the 250 KB budget; do not alter unrelated backend behavior.

## Acceptance criteria

- [x] Initial web bundle is at most 250 KB gzip.
- [x] pnpm check and relevant browser smoke tests pass.

## Plan

1. Measure built entry assets against the unchanged 250 KB gzip gate.
2. Remove shared Button/Slot/style-helper fan-out from always-loaded root recovery controls, preserving native keyboard behavior and tokens.
3. Verify the budget, browser not-found recovery and full pnpm check. No root tooling or budget changes.

## Log

- 2026-10-26: Created from actual integration check output recorded in /tmp/t075-fraunces-check-rerun.log.

## Links

- [Performance budget](../../docs/16-performance-and-scale.md)
- [Cofounder review plan](../../docs/handoffs/2026-10-26-cofounder-review-plan.md)

- 2026-10-26 — The lane B build measured 257.6 KB before the dependency change and 246.7 KB after it. Full checks and browser recovery acceptance pending.

- 2026-10-26 — Ready for human review: full pnpm check passed (frontend 367, backend 973 tests), independent code QA approved and fresh-context browser QA accepted the implemented workflows. See docs/handoffs/2026-10-26-lane-b-qa.md for exact commands, evidence and mocked-API limits.

- 2026-10-28 — Source audit confirms the existing delivered behavior and previously checked acceptance criteria. Tracking reconciled under T-117; final branch regression evidence is recorded in docs/handoffs/2026-10-28-lane-b-closeout.md.
