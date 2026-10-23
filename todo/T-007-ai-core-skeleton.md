---
id: T-007
title: Add packages/ai-core LLM gateway skeleton with eval runner
status: backlog
type: chore
priority: P1
owner:
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch:
pr:
parent:
---

## Context

ADR-005: all LLM calls go through a gateway with provider abstraction, fallback, metering and versioned prompts. Evals gate every prompt/model change (`docs/06-ai-engine.md` §8, `docs/13-testing-and-quality.md` §2).

## Goal

`packages/ai-core` exposes `generate()` with a provider interface, one real provider adapter behind an env flag plus a deterministic fake provider for tests, prompt loading by `<name>@<version>`, usage/cost accounting, and `evals/` with a runner that executes YAML cases against the fake provider in CI.

## Scope

- Provider interface, fake provider, one real adapter (chosen per `docs/14-open-decisions.md` B5).
- Prompt registry from `prompts/*.md` with version in filename.
- `evals/` format from `docs/13-testing-and-quality.md` §2.1 and a runner with deterministic checks (numbers must come from sources, required tool calls).
- Cost table config per model (no secrets).

## Out of scope

- Retrieval, tools, guardrails (separate feature tasks).

## Acceptance criteria

- [ ] `pnpm --filter ai-core test` runs 3+ eval cases against the fake provider.
- [ ] No network access in tests.
- [ ] README explains how to add a prompt version and an eval case.

## Plan

## Log

- 2026-10-23 — created.

## Links

- Docs: `docs/06-ai-engine.md`, `docs/adr/ADR-005-llm-gateway.md`
