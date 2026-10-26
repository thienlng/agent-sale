---
id: T-065
title: Admin LLM: check connection and fetch model list from the provider dialog
status: done            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: @agent:claude
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-26
branch: feat/T-065-admin-llm-discover-models
pr: '#56'
parent:                    # T-xxx if this is a sub-task
---

## Context

Reported by the maintainer while testing the admin "AI models" page: a provider that was entered correctly could not be verified (the test needed a model id and only existed on saved providers), and model ids had to be typed by hand in the tier routes.

## Goal

An admin can check a provider's connection from the add/edit dialog before saving and pick model ids from the server's own list.

## Scope

- In scope: `POST /admin/llm/providers/models` (works on unsaved settings; reuses the stored key only while the host is unchanged), `listModels()` on the OpenAI-compatible and Anthropic providers, "Check connection" in the provider dialog, a model picker with a fetch button in the tier routes.

## Out of scope

- Hermes model listing (the bridge has no listing endpoint; the field stays free text).
- Caching model lists.

## Acceptance criteria

- [x] The dialog checks the connection without saving and reports the number of models or the provider error.
- [x] Tier route model fields offer a fetch button listing models, with a filter; typing stays possible.
- [x] A stored key is never sent to a different host during a check.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (or "no docs impact" stated)

## Plan

1. Contracts: request/response schemas and route.
2. ai-core: optional `LlmProvider.listModels()`.
3. Backend: `LlmAdminService.discoverModels` plus controller route; unit tests.
4. Web: `useDiscoverModels`, dialog check button, `ModelPicker`; vi/en strings.

## Log

- 2026-10-24 — created from maintainer feedback; implemented. Hermes has no listing endpoint, so the button is hidden for it.

- 2026-10-26 — merged into main with PR #56.

## Links

- Follows T-052 / the admin LLM page.
