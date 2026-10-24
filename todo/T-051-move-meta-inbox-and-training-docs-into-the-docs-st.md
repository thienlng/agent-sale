---
id: T-051
title: Move Meta inbox and training docs into the docs structure
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: docs
priority: P3
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-045
---

## Context

PR #40 review (Rule 06). The PR added `docs/superpowers/{plans,specs}/` (planning artifacts, still saying Razpi), `docs/meta-inbox.md` and `docs/training-workspace.md`, which do not follow the docs structure (numbered docs, `adr/`, `reference/`, `runbooks/`, `integrations/<provider>.md`).

## Goal

Docs follow Rule 06: Meta connector facts in `docs/integrations/meta.md`, training behaviour folded into the numbered docs, planning artifacts in the task files.

## Scope

- `docs/meta-inbox.md` → `docs/integrations/meta.md` with Graph API version, scopes, limits and date checked; live-test steps → `docs/runbooks/`
- `docs/training-workspace.md` → relevant numbered doc sections
- Fold useful content of `docs/superpowers/**` into `todo/done/T-045` / `T-047` logs, then delete the folder
- Fix links (`docs/README.md`, MODULE.md files)

## Out of scope

- Content changes beyond moving and dating

## Acceptance criteria

- [ ] No `docs/superpowers/`; links resolve
- [ ] `docs/integrations/meta.md` states the date each external claim was checked
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created from the PR #40 review (maintainer session).

## Links

- Docs: …
- Related tasks: T-045, T-047 (PR #40)
