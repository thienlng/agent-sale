---
id: T-130
title: Upgrade i18next to 26 and react-i18next to 17 together
status: done
type: chore              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: "@agent:claude"
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-29
updated: 2026-10-30
branch: build/T-130-i18next-26
pr: 86
parent:                    # T-xxx if this is a sub-task
---

## Context

Dependabot opened #67 (i18next 25 → 26) and #68 (react-i18next 16 → 17) separately. Both are major versions (Rule 08: no casual major bumps), react-i18next 17 is meant to run with i18next 26, and #67 was red on an old base. The owner asked (2026-10-28) to fix every open PR.

## Goal

The dashboard runs on i18next 26 and react-i18next 17, upgraded together, with the gate green.

## Scope

- In scope: both version ranges in `apps/web/package.json` and the lockfile; any type or runtime fix the upgrade needs.

## Out of scope

- Other dependency bumps (#66, #71).

## Acceptance criteria

- [x] `apps/web` typechecks with the stricter i18next 26 types (plural keys need `count`, typed ICU arguments) without code changes
- [x] Web unit tests and build green; initial bundle within budget
- [ ] CI green, including both e2e jobs
- [x] No docs impact (no API or behaviour change)

## Plan

1. Bump both ranges together, install, typecheck, test, build.
2. Fix whatever the stricter types or runtime changes break (nothing did).
3. Open one PR that replaces #67 and #68.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-29 — created.
- 2026-10-29 — `apps/web` is the only package using either library. After the bump: web typecheck clean, 78 files / 511 tests, build green, initial bundle 235.9 KB (budget 250 KB), lint 0 errors.
- 2026-10-30 — merged to main (PR #86); closed in the version 1 close-out (T-158).

## Links

- Docs: none
- Related: Dependabot PRs #67, #68
