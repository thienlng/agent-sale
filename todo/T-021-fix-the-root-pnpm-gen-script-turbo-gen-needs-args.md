---
id: T-021
title: Fix the root pnpm gen script (turbo gen needs --args)
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: chore
priority: P2
owner:                     # @github-handle or @agent:<tool>
feature_ids: []
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

`pnpm gen module <name>` fails with "unrecognized subcommand"; `pnpm turbo gen module --args <name>` works (found in T-016).

## Goal

The documented generator commands in AGENTS.md work as written.

## Scope

- Root `package.json` gen script (root tooling: needs this task).
- Keep AGENTS.md / docs commands in sync.

## Out of scope

- …

## Acceptance criteria

- [ ] `pnpm gen module x` and `pnpm gen feature x` scaffold correctly (then delete the test output).

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

## Links

- Docs: …
- Related tasks: …
