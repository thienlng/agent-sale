# ADR-005: Multi-provider LLM Gateway, commercial tiers

- Status: Proposed · Date: 2026-10-23

## Decision
The `ai-core` package provides a unified interface, fallback chain, metering, and prompt versioning. The Basic/Smart/Pro/Neo tiers are pipeline configurations (model, retrieval, rerank, verifier); the model mapping is configured by admins and chosen using Vietnamese evals (quality × cost × latency). Langfuse for tracing.

## Implementation notes (M2, 2026-10-24)
- Providers: `AnthropicProvider` (official SDK, cached system prefix, server-side refusal fallback where supported) and `OpenAiCompatibleProvider` (official `openai` SDK with a custom `baseURL`, for OpenAI and self-hosted model servers).
- The mapping is data, not config files or env: `llm_providers` + `llm_tier_routes`, edited by platform admins, keys encrypted at rest (docs/06 §7, docs/09 §5).
- Langfuse tracing and the eval gate are still to do (T-007).

## Consequences
Changing/adding models does not change business code; every change to the model mapping must pass the eval gate. Sign DPAs and choose endpoints that do not use data for training.
