---
id: T-069
title: Make team assignment history integration coverage deterministic
status: done
type: bug
priority: P1
owner: "@agent:codex"
feature_ids: [SET-02]
created: 2026-10-25
updated: 2026-10-25
branch: feat/T-068-sales-inbox
pr: 59
parent: T-068
---

## Context

PR #59's CI integration job failed at team.integration.spec.ts:545. The test creates six contacts concurrently, removes Chi and transfers their contacts, then assumes the first response's newest history entry is contact.created. The first response can belong to Chi, whose newest history entry is correctly contact.assigned. This unrelated pre-existing flaky assertion blocks the inbox PR; Rule 08 permits the minimal blocking fix.

## Goal

Cover both auto-assigned creation and subsequent member-removal reassignment without depending on concurrent request order.

## Scope

- Select a contact owned by the removed member explicitly and assert both relevant history events.

## Out of scope

- Production assignment or history behavior, tooling configuration and test timeouts.

## Acceptance criteria

- [x] The old newest-entry assertion fails deterministically for the selected transferred contact.
- [x] The final test verifies the newer reassignment and the original auto-assigned creation.
- [x] Isolated PostgreSQL integration coverage and pnpm check pass without weakening tests.
- [x] Independent QA reviewed the test change.

## Plan

1. Select an explicitly Chi-owned contact from the concurrent creates and reproduce the old assertion failure.
2. Check the actual latest reassignment and search history for the original creation event.
3. Run the team integration suite, full gate and QA review. No docs impact beyond this task because production behavior is unchanged.

## Log

- 2026-10-25 — Full team suite passed all 11 tests on isolated PostgreSQL. Final pnpm check passed all 705 unit/contract tests and all remaining gates/builds. Independent QA approved the exact diff. No production behavior or test timeout changes.

- 2026-10-25 — Reproduced deterministically on isolated Testcontainers Postgres: selecting a Chi-owned contact makes the original newest-entry assertion fail with contact.assigned/member_removed instead of contact.created. No production data or shared database used.

- 2026-10-25 — Created from CI job 121111057543. Confirmed the inbox diff does not change this test or assignment/history implementation.

## Links

- [Failing CI job](https://github.com/thienlng/agent-sale/actions/runs/40174130717/job/121111057543)
- [Parent task](T-068-redesign-the-sales-inbox-workspace.md)
