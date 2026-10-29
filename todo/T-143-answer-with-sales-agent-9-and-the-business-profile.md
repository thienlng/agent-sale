---
id: T-143
title: Answer with sales-agent@9 and the business profile
status: review
type: feat
priority: P1
owner: @agent:claude
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: feat/T-137-bot-profile
pr:
parent: T-137
---

## Context

Last task of the bot-training redesign (docs/superpowers/specs/2026-10-29-bot-training-redesign-design.md): the prompt and profile rendering exist (T-138); live and playground replies still use `sales-agent@8`, and readiness still asks for placeholders.

## Goal

Playground and live replies use `sales-agent@9`; bot readiness and the setup guide measure business profile completeness instead of placeholders.

## Scope

- In scope: default `promptVersion` 9, deterministic prompt tests, `profile` readiness check (backend, contract, web setup guide, i18n), docs.

## Out of scope

- Live-model evals (no eval runner yet, T-007); removing `settings.placeholders` (kept read-only one release); running the backfill on a real database.

## Acceptance criteria

- [x] Default prompt is `sales-agent@9`; `ai_runs.prompt_version` records it; v8 stays pinnable and byte-identical
- [x] Tests: data-not-instructions and (not provided) rules in the system prompt; empty hotel `deposit` renders `(not provided)`; injected notes stay inside the escaped block
- [x] Readiness `profile` check replaces `placeholders`; setup guide has a "Thông tin doanh nghiệp" step linking to the knowledge page
- [x] Docs updated

## Plan

Flip the default; fix fixtures lacking a profile; swap the readiness check key and add a web step.

## Log

- 2026-10-29 — implemented. Verified with the dev-fake provider inside the playground specs only. Live-model evals were NOT run (no eval runner, T-007). The backfill dry run on the dev database is left to the controller/owner.
- 2026-10-29 — Final fix wave: profile fields and notes are trusted text for the number guardrail (decide); prompt @9 unknown rule no longer suppresses answers present in other blocks; Vietnamese polite register and the no-wait rule restored in the style line; e2e readiness mock uses the profile check.

## Links

- Docs: docs/training-workspace.md, apps/backend/src/modules/ai/MODULE.md
