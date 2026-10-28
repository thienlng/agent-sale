---
id: T-108
title: Add an account-level portfolio layer with its own navigation
status: review
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: "@agent:claude"
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-28
updated: 2026-10-28
branch: feat/T-108-account-portfolio-layer
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Owner review of main on 2026-10-28 (issue #74). T-081 made statistics the home of the selected business, but there is no outer layer for an account that owns several businesses. The logo only returns to one business.

## Goal

Clicking the logo opens an account-level portfolio page, and only choosing a business enters that business's management screens.

## Scope

- Account portfolio page: all authorized businesses with per-business summary statistics. It is distinct from the current business management screen.
- A separate left menu for the account layer; the business layer keeps its current menu.
- Selecting a business enters its management screen; a logo or breadcrumb returns to the account layer.

## Out of scope

- Account-level plans, quota and settings (T-091..T-093); new unapproved metrics.

## Acceptance criteria

- [ ] Logo on every screen opens the account portfolio page.
- [ ] Account sidebar differs from the business sidebar.
- [ ] Per-business figures match existing metric definitions; no data leaks between businesses.
- [ ] Selecting a business opens its management screen.
- [ ] Responsive 375-1920 px and keyboard navigable.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-28 — created.

## Links

- Issue: #74
- Related tasks: T-081, T-091..T-094
