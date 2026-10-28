---
id: T-113
title: Split responsive route coverage into independently timed cases
status: in-progress
type: bug
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch: feat/tung-dev
pr:
parent: T-112
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

- [ ] Every existing route/viewport pair remains covered.
- [ ] Heading, no-overflow and runtime-error assertions remain intact.
- [ ] Existing preference cases remain intact; no test timeout is increased.
- [ ] Independent QA approves the restructuring and the official suite passes.
- [ ] The full gate and final branch delivery pass without protected config changes.

## Plan

1. Record the original failing official run and unchanged diagnostic results.
2. Generate one test for each existing page/viewport pair using the same mock setup and assertions.
3. Run the unchanged full gate, rebuild the current source and request independent official browser acceptance.
4. Commit the test-harness fix with the lane B closeout; retain the original evidence limits.

## Log

- 2026-10-28 — Created before changing the responsive test. Fresh same-model QA agrees the complete matrix should be preserved and isolated by case; no confirmed product drawer bug was found.

## Links

- Scope: T-112 lane B closeout.
- Existing guard: apps/web/e2e/responsive.spec.ts.
- Official original log: /tmp/lane-b-responsive.log; diagnostic: /tmp/lane-b-responsive-375-diagnostic.log.
