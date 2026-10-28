---
id: T-118
title: Split responsive route coverage into independently timed cases
status: done
type: bug
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch: feat/tung-dev
pr:
parent: T-117
---

## Context

The final lane B layout guard timed out in all four viewport walkers: each test navigates 28 routes under one shared 30-second Playwright budget. Independent QA reproduced 2 passes/4 global timeouts with two workers; no overflow assertion failed. An unchanged diagnostic at 375px completed all 28 routes in 25.4 seconds with one worker, showing little headroom under parallel local load. The extended diagnostic budget is not acceptance evidence.

## Goal

Keep complete responsive route/viewport coverage with meaningful independent failures instead of one monolithic timeout.

## Scope

- Split the existing route/viewport matrix into independently named Playwright tests.
- Preserve all 28 routes, four viewport sizes, heading, overflow and runtime-error assertions.
- Keep the original 30-second per-test configuration and preference/layout tests unchanged.

## Out of scope

- Product CRM changes, root tooling configuration, increased timeouts, skipped routes or removed assertions.
- Using the longer diagnostic timeout as a passing release gate.

## Acceptance criteria

- [x] Every existing route/viewport pair remains covered.
- [x] Heading, no-overflow and runtime-error assertions remain intact.
- [x] Existing preference cases remain intact; no test timeout is increased.
- [x] Independent QA approves the restructuring and the official suite passes.
- [x] The full gate and final branch delivery pass without protected config changes.

## Plan

1. Record the original failing official run and unchanged diagnostic results.
2. Generate one test for each existing page/viewport pair using the same mock setup and assertions.
3. Run the unchanged full gate, rebuild the current source and request independent official browser acceptance.
4. Commit the test-harness fix with the lane B closeout; retain the original evidence limits.

## Log

- 2026-10-28 — Created before changing the responsive test. Fresh same-model QA agrees the complete matrix should be preserved and isolated by case; no confirmed product drawer bug was found.

## Links

- Scope: T-117 lane B closeout.
- Existing guard: apps/web/e2e/responsive.spec.ts.
- Official original log: /tmp/lane-b-responsive.log; diagnostic: /tmp/lane-b-responsive-375-diagnostic.log.

- 2026-10-28 — Final frozen source passed full pnpm check (backend 1,104 and frontend 499 tests; bundle 232.1 KB). Fresh same-model independent QA approved 47/47 functional and 114/114 responsive browser cases with unchanged timeout/assertions and reviewed the 390px image. Delivery report: docs/handoffs/2026-10-28-lane-b-closeout.md. Prepared for the owner-requested feat/tung-dev push; main is not a landing target.

- 2026-10-28 — Renumbered this unpublished integration task from T-113 to T-118 after fetching concurrently published cofounder tasks. All four fetched feature branches were inspected; their highest ID is T-116. Historical local commit footers retain the earlier alias; no published source history was rewritten.
