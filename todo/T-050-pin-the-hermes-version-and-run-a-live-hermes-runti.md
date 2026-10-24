---
id: T-050
title: Pin the Hermes version and run a live hermes-runtime acceptance probe
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: chore
priority: P1
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-045
---

## Context

PR #40 review (H2). `services/hermes/runtime.py` calls Hermes internals (`run_budget_seconds`, `load_soul_identity`, `skip_background_review`, system-prompt hooks), but no Hermes version is pinned and CI only exercises a fake agent. The bridge is dev/staging only until this lands (docs/ARCHITECTURE.md §7).

## Goal

A reproducible hermes-runtime: pinned Hermes version, documented install, and a recorded live acceptance probe.

## Scope

- `services/hermes/requirements.txt` (or `pyproject.toml`) pinning the verified Hermes version/commit
- README install steps without machine-specific paths
- A manual live probe script (one turn, health, 429 under load) and its dated result in this file's Log
- Supervision notes for deployment (systemd/compose), one `HERMES_HOME` per instance

## Out of scope

- Porting Hermes to TypeScript

## Acceptance criteria

- [ ] Pinned version installs in a clean venv and passes `python -m unittest`
- [ ] Live probe result recorded with date
- [ ] ARCHITECTURE §7 'Version' row updated
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
