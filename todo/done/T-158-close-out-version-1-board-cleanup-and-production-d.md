---
id: T-158
title: Close out version 1: board cleanup and production dependency bump
status: done
type: chore
priority: P1
owner: agent:claude
feature_ids: []
created: 2026-10-30
updated: 2026-10-30
branch: chore/T-158-close-out-version-1
pr:
parent:
---

## Context

The owner asked for a stable version 1 on main with no open PRs or issues, so version 2 can start from a clean state (chat request, 2026-10-30).

## Goal

Main carries every merged v1 change, the board reflects it, and nothing is left open on GitHub.

## Scope

- In scope: close the board entries of tasks merged in PRs #85, #86 and #88; apply the production-minor dependency bump from Dependabot PR #87 (recharts 3.10.1, @anthropic-ai/sdk ^1.3.0, bullmq ^6.4.2) as a conventional commit, because Dependabot no longer rebases #87.

## Out of scope

- Major dependency bumps (T-131) and every backlog item — version 2.

## Acceptance criteria

- [x] T-088, T-089, T-091, T-124, T-130, T-155 and T-157 are done and live in `todo/done/`
- [x] The dependency bump passes `pnpm check`
- [x] Docs updated (or "no docs impact" stated) — no docs impact

## Plan

1. Move the merged tasks to `todo/done/` and update the board.
2. Bump the three packages, refresh the lockfile, run the gate.
3. Close #87 as superseded once this PR merges.

## Log

- 2026-10-30 — created. PRs #84, #85, #86, #88 and #89 merged; #67, #68, #71 closed; all issues closed (v1 cut).

## Links

- Related tasks: T-124, T-131, T-155
