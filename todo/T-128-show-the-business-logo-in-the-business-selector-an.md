---
id: T-128
title: Show the business logo in the business selector and lists
status: review
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: "@agent:claude"
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-28
updated: 2026-10-29
branch: feat/T-124-integrate-lane-a2
pr: 84
parent:                    # T-xxx if this is a sub-task
---

## Context

Owner review of PR #76: a business without an icon looks bare in the selector. The logo already exists (Settings › Shop profile, T-056) but is only shown there.

## Goal

The business logo (or a building icon without one) appears in the business selector, the account sidebar and the portfolio list.

## Scope

- Memberships carry `logoVersion` (bootstrap); `BusinessAvatar` reads the logo with each business's own scope.
- Saving the profile or changing the logo updates the session so lists refresh without a reload.

## Out of scope

- A second icon field: the logo is the icon and is edited in Settings › Shop profile.

## Acceptance criteria

- [x] Selector trigger, selector rows, account sidebar and portfolio rows show the logo or a fallback icon.
- [x] Changing the logo updates the lists without F5.
- [x] Tests added and `pnpm check` green
- [x] Docs: no impact (UI only; the membership field is optional)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-28 — created.
- 2026-10-29 — Renumbered from T-110 (PR #76) to T-128 when integrated under T-124: T-110 already names another task on main (T-119). Commits made before the move still say T-110.

## Links

- Docs: …
- Related tasks: …
