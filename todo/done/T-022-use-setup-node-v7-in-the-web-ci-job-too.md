---
id: T-022
title: Use setup-node v7 in the web CI job too
status: done
type: chore
priority: P2
owner: @agent:claude
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch: chore/T-022-setup-node-v7-web
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Dependabot PR #14 (setup-node 4 → 7) was created before #13 added the `web` CI job, and both were merged minutes apart, so the new job kept `setup-node@v4`.

## Goal

Every CI job uses the same `actions/setup-node` version.

## Scope

- `.github/workflows/ci.yml`: `web` job → `actions/setup-node@v7`.
- TODO.md: M2 milestone merged (#13).

## Out of scope

- Other action versions.

## Acceptance criteria

- [x] `grep setup-node .github/workflows/ci.yml` shows only v7.
- [x] CI green on the PR (the `web` job runs on v7).

## Plan

One-line workflow change.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

## Links

- Docs: …
- Related tasks: …
