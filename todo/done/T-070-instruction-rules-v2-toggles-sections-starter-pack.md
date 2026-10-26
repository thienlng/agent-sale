---
id: T-070
title: Instruction rules v2: toggles, sections, starter pack and visible system rules
status: done            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-25
updated: 2026-10-26
branch:
pr: '#58'
parent:                    # T-xxx if this is a sub-task
---

## Context

Owner asked to learn from Diro's prompt configuration screens (grouped rules with toggles, locked system rules, starter rules). Compared with Rapiz's flat scenario list.

## Goal

Instruction rules with on/off toggles, sections, a Vietnamese starter pack for new bots and a visible list of the platform's locked rules.

## Scope

- In scope: `enabled` + `section` on scenarios (migration 0016), prompt grouping and caps, starter pack + route + seeding on bot creation, rules list UI, history labels, docs.

## Out of scope

- Numeric reply-length setting, per-product/link rule tabs, order creation tool.

## Acceptance criteria

- [x] Disabled rules never reach the model; rules grouped into general / after-order.
- [x] New bots start with the starter pack (8 rules); the button is idempotent and race-safe.
- [x] Starter rules invent no shop policy (payment rule reworded after review).
- [x] Review done, findings fixed; `pnpm check` green (2026-10-25).
- [ ] Model-dependent QA (rule obeyed/disabled in a real reply, "k" price in a real conversation) once Hermes is available again.

## Plan

Contracts + migration first, then backend and web in parallel, then independent review and real-stack QA.

## Log

- 2026-10-25 — implemented (contracts/migration, backend, web); review found 2 major starter-content issues and minor ones, all fixed except the onboarding-step semantics (intentionally unchanged).
- 2026-10-25 — real-stack QA PASS: migration, starter pack on a new bot, idempotency, cross-workspace 404, toggle/section history + restore, prompt text with/without a rule, grounding "k" form offline, web page (groups, toggle, copy, search, locked group). NOT RUN: model-dependent checks (Hermes 503). Known: empty-body POST with a JSON content-type returns 500 instead of 4xx (Fastify parser; the web client is unaffected).

- 2026-10-26 — merged into main with PR #58.

## Links

- Docs: `docs/training-workspace.md`, `docs/06-ai-engine.md`
- Related tasks: T-055 (API actions)
