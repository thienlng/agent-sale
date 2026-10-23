# ADR-005: Multi-provider LLM Gateway, commercial tiers

- Status: Proposed · Date: 2026-10-23

## Decision
The `ai-core` package provides a unified interface, fallback chain, metering, and prompt versioning. The Basic/Smart/Pro/Neo tiers are pipeline configurations (model, retrieval, rerank, verifier); the model mapping is configured by admins and chosen using Vietnamese evals (quality × cost × latency). Langfuse for tracing.

## Consequences
Changing/adding models does not change business code; every change to the model mapping must pass the eval gate. Sign DPAs and choose endpoints that do not use data for training.
