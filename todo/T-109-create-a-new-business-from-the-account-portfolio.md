---
id: T-109
title: Create a new business from the account portfolio
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

Owner review of main on 2026-10-28 (issue #75). The backend already has `POST` create-workspace, but the web has no screen or button that calls it, so a business can only be created at signup.

## Goal

An account owner can create a new business from the web.

## Scope

- "Create business" button on the account portfolio (T-108) and a creation form that enters the new business.
- Respect permissions and plan rules (T-091..T-093); show clear errors.

## Out of scope

- Changing plan or quota rules.

## Acceptance criteria

- [ ] The button creates a business and opens it; its data is isolated from other businesses.
- [ ] Denied creation shows a clear error.
- [ ] Web tests and e2e for the flow; `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-28 — created.

## Links

- Issue: #75
- Related tasks: T-108, T-091..T-093
