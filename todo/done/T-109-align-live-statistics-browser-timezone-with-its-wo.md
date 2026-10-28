---
id: T-109
title: Align live statistics browser timezone with its workspace
status: done
type: bug
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch: feat/T-107-inbox-compose-continuity
pr: 72
parent: T-107
---

## Context

PR #72 CI run 40544878197 failed the existing live statistics story after 17:00 UTC: the browser used UTC while the newly created workspace uses Asia/Ho_Chi_Minh. CRM rows were created on the workspace's next calendar day, outside the browser's default date range. The previous run before this boundary passed with identical application code.

## Goal

Run the live CRM statistics acceptance story with a browser timezone matching its workspace, independent of the CI runner timezone.

## Scope

- Set the existing statistics test's browser context to Asia/Ho_Chi_Minh.
- Preserve real backend assertions, fixture creation, clock progression and all test steps.

## Out of scope

- Product statistics timezone semantics for users browsing from another timezone.
- Inbox implementation, other screens, shared Playwright configuration or CI workflows.

## Acceptance criteria

- [x] Statistics browser context matches the workspace's default timezone.
- [x] Existing real-backend statistics assertions pass; Chromium verifies the date boundary at 17:00 UTC.
- [x] No assertion, retry, timeout or test is weakened or skipped.
- [x] `pnpm check` passes and independent QA approves.

## Plan

1. Add a file-local Playwright timezone setting with a comment explaining the workspace fixture.
2. Run the full local gate and rerun live-backend CI; review the change independently.
3. Record results here. No runtime, API, schema or product documentation changes are needed.

## Log

- 2026-10-28 — Created from CI evidence, before changing the test. Added to the existing PR as a small verification blocker under the same task block; no new implementation branch.

- 2026-10-28 — Fresh same-model QA approved. Chromium boundary check at 2026-10-27T17:00:00Z reproduces October 27 in UTC and October 28 in Asia/Ho_Chi_Minh. The subsequent live-backend CI passed.

- 2026-10-28 — `pnpm check` passed: all 12 build tasks successful, frontend 454 tests, unchanged 229.4 KB initial gzip bundle. Live-backend CI run 40611334354 passed; remaining PR-wide checks are monitored separately. No runtime/docs impact.

## Links

- PR: https://github.com/thienlng/agent-sale/pull/72
- Failing run: https://github.com/thienlng/agent-sale/actions/runs/40544878197
- Workspace default: `packages/db/src/schema/workspace.ts` and `apps/backend/src/modules/workspace/domain/workspace.ts`.
