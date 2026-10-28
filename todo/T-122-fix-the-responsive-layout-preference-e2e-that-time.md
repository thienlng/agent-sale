---
id: T-122
title: Fix the responsive layout-preference e2e that times out on main
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: bug              # feature | bug | chore | spike | docs
priority: P2               # P0 | P1 | P2 | P3
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-28
updated: 2026-10-28
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Found during T-120 (2026-10-28): `apps/web/e2e/responsive.spec.ts` › "every layout preference combination fits, expanded and collapsed" fails on `main` before any T-120 change — the 30 s test timeout expires while clicking "Mở hoặc thu gọn thanh bên" partway through the 12 combinations (also with retries, run alone).

## Goal

The layout-preference e2e passes reliably locally and in CI.

## Scope

- In scope: …

## Out of scope

- …

## Acceptance criteria

- [ ] Verifiable statement 1
- [ ] Verifiable statement 2
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-28 — created.

## Links

- Docs: …
- Related tasks: …
