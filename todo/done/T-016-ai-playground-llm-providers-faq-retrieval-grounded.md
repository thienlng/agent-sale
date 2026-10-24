---
id: T-016
title: AI playground: LLM providers, FAQ retrieval, grounded replies, metering
status: done
type: feature              # feature | bug | chore | spike | docs
priority: P0
owner: @agent:claude
feature_ids: [BOT-14, ADM-06]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-015-m2-bot-playground (milestone M2)
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

M2: an owner tests the bot in the dashboard before connecting channels (docs/06 §3, ADR-005). Owner request during the task: support self-hosted models via an OpenAI-compatible endpoint, and manage LLM providers/tier routing in the database through an admin UI instead of env.

## Goal

`POST /bots/{botId}/playground` returns a grounded, metered reply; platform admins configure which provider/model serves each tier.

## Scope

- `packages/ai-core`: `AnthropicProvider` (official SDK, cached system prefix, structured output, refusal fallback) and `OpenAiCompatibleProvider` (OpenAI SDK + custom `baseURL`; json_schema / json_object / none); `ModelTarget` with effort; `stopReason`; prompt `sales-agent@2`.
- Migration 0003: `ai_runs` (tenant, RLS), `llm_providers` + `llm_tier_routes` (global, app_system only), `users.is_platform_admin`.
- `ai` module: `LlmRuntime` (gateway from DB, 10 s cache + invalidate), playground pipeline with guardrails, admin API `/admin/llm/*` (providers CRUD, connection test, tier routes), `ai_runs` + Prometheus metrics.
- `SecretBox` (AES-256-GCM, `SECRETS_ENCRYPTION_KEY`) for API keys; `@PlatformAdmin()` guard; CLI `platform-admin grant|revoke`; `AI_UNAVAILABLE` (503).

## Out of scope

- Admin UI pages (T-005 web, same milestone), tools/function calling, embeddings/hybrid retrieval, streaming, Langfuse + eval gate (T-007), credit charging (billing), per-contact rate limits.

## Acceptance criteria

- [x] Unaccented question finds the FAQ; reply cites it; `ai_runs` row with tokens/latency/sources (`is_test`), isolated by RLS.
- [x] Fallback/handoff use the bot's messages; figures not in sources → fallback; refusal → handoff; invalid output → fallback.
- [x] Providers/tiers editable by platform admins only (others 404); API key encrypted, never returned; provider in use cannot be deleted; unreachable provider → test reports error, playground 503.
- [x] `pnpm check` green; integration: backend 8, db 9.
- [x] Docs: 05, 06 §7, 09 §5, 10 §1, ARCHITECTURE, ADR-005 notes, MODULE.md.

## Plan

Providers in ai-core → contracts → migration → ai module (runtime, admin, playground) → identity admin flag → tests → docs.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

- 2026-10-24 — owner asked for an OpenAI-compatible provider (self-hosted models) and DB/admin-managed config instead of env; env-based routing was dropped before commit.
- 2026-10-24 — done. Verified with `pnpm check`, `pnpm test:integration` (backend 8/8, db 9/9). No real provider was called (no keys used in tests).

## Links

- Docs: …
- Related tasks: …
