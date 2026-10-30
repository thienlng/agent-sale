---
id: T-131
title: Triage the dev-dependency major bumps from Dependabot PR 71
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-29
updated: 2026-10-29
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Dependabot PR #71 groups 12 dev-dependency updates, several of them major: `@commitlint/cli` and `@commitlint/config-conventional` 19 → 21, `@eslint/js` 9 → 10, `eslint` 9 → 10, `lint-staged` 16 → 17, and `@types/node` 24 → 26. Its `check` job fails on current main. `@types/node` 26 describes Node 26 APIs while the repo runs Node 24 (`.nvmrc`, `engines`), so that bump is wrong as such. ESLint 10 and commitlint 21 may need changes to `eslint.config.js` / `commitlint.config.js`, which are protected root tooling config (Rule 08).

## Goal

Each major dev-tool bump is either applied with its config changes and a green gate, or ignored on purpose in Dependabot's config.

## Scope

- In scope: reproduce #71's failure; split it per tool; decide `@types/node` (pin to the Node major in use, ignore majors in `.github/dependabot.yml`); upgrade ESLint/commitlint/lint-staged with whatever config they need, with the owner's approval for protected files.

## Out of scope

- Production dependency updates (#66) and the i18next upgrade (T-130).

## Acceptance criteria

- [ ] `@types/node` follows the Node major in `.nvmrc`, and Dependabot no longer proposes a newer major
- [ ] Each remaining major bump is merged with a green `pnpm check`, or explicitly ignored with a reason
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-29 — created.

## Links

- Docs: `.agents/rules/04-code-quality.md` (the gate), `.agents/rules/08-agent-behavior.md` (protected files)
- Related: Dependabot PR #71; T-130
