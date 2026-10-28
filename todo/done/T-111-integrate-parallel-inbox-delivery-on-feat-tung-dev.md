---
id: T-111
title: Integrate parallel inbox delivery on feat tung-dev
status: done
type: chore
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch: feat/tung-dev
pr:
parent:
---

## Context

The owner requested consolidating Claude's completed Facebook-comments work (T-106, PR #73) and Codex's DM composition continuity (T-107, PR #72) onto `feat/tung-dev`. Both source worktrees were clean. The destination did not exist remotely when checked. The explicitly requested branch name overrides the normal task-number branch convention for this integration.

## Goal

Push a verified combined Inbox delivery to `origin/feat/tung-dev`, preserving both source histories and leaving main unchanged.

## Scope

- Merge T-106 head `3f2ef52` into T-107 head `d92ff58` without rewriting source branches.
- Resolve shared vi/en i18n additions by preserving both namespaces, and reconcile task-board status.
- Preserve the renamed T-110 authorization follow-up alongside T-108/T-109.
- Record independent final QA, local gate and combined browser verification.

## Out of scope

- Landing on main, implementing T-110, changing unrelated product screens or calling Meta with real customer data.

## Acceptance criteria

- [x] Both complete source branch heads are ancestors of the integration head.
- [x] Both i18n namespaces and correct task references are preserved without conflict markers.
- [x] Independent same-model QA resolves the four former T-106 blockers and reviews integration boundaries.
- [x] `pnpm check` and relevant combined Inbox browser tests pass.
- [x] Clean destination branch is pushed to `origin/feat/tung-dev`.

## Plan

1. Fetch and inspect source heads, cleanliness, PR evidence and destination state.
2. Resolve the task-board and i18n conflicts while retaining both feature implementations.
3. Run the full gate and combined Inbox browser scenarios; request fresh same-model QA.
4. Commit the merge and verification record, then push the owner-requested branch without force or main changes.

## Log

- 2026-10-28 — Created before integration implementation changes. Only conflicts are TODO.md and channel-inbox vi/en catalogs. Application code and sales Inbox documentation merge cleanly.

- 2026-10-28 — Merge commit fb076b7 contains both source heads. Fresh same-model QA approved all four former T-106 findings and integration boundaries (29 frontend + 20 backend focused tests).
- 2026-10-28 — `pnpm check` passed: frontend 491 tests, backend 1,100 tests; initial gzip bundle 231.9 KB. Combined production-build Playwright passed 28/28; rebuilt HTTP/store integration passed 10/10; full-history Gitleaks passed. The first direct integration attempt used stale built contracts; rebuilding and rerunning resolved it without code changes.
- 2026-10-28 — Delivery prepared for the explicitly requested origin/feat/tung-dev push; no main landing or source-branch rewrites. Full report: docs/handoffs/T-111-inbox-integration.md.

## Links

- T-106: https://github.com/thienlng/agent-sale/pull/73
- T-107: https://github.com/thienlng/agent-sale/pull/72
- Prior findings: `docs/handoffs/T-106-snapshot-review.md`.
