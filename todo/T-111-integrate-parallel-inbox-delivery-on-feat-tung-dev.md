---
id: T-111
title: Integrate parallel inbox delivery on feat tung-dev
status: in-progress
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

- [ ] Both complete source branch heads are ancestors of the integration head.
- [ ] Both i18n namespaces and correct task references are preserved without conflict markers.
- [ ] Independent same-model QA resolves the four former T-106 blockers and reviews integration boundaries.
- [ ] `pnpm check` and relevant combined Inbox browser tests pass.
- [ ] Clean destination branch is pushed to `origin/feat/tung-dev`.

## Plan

1. Fetch and inspect source heads, cleanliness, PR evidence and destination state.
2. Resolve the task-board and i18n conflicts while retaining both feature implementations.
3. Run the full gate and combined Inbox browser scenarios; request fresh same-model QA.
4. Commit the merge and verification record, then push the owner-requested branch without force or main changes.

## Log

- 2026-10-28 — Created before integration implementation changes. Only conflicts are TODO.md and channel-inbox vi/en catalogs. Application code and sales Inbox documentation merge cleanly.

## Links

- T-106: https://github.com/thienlng/agent-sale/pull/73
- T-107: https://github.com/thienlng/agent-sale/pull/72
- Prior findings: `docs/handoffs/T-106-snapshot-review.md`.
