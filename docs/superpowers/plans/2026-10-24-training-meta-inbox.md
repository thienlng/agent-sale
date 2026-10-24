# Training and Meta Inbox Implementation Plan

> **For agentic workers:** Use subagent-driven-development for scoped implementation and independent QA. User authorization in chat supersedes repeated design approval checkpoints.

**Goal:** Deliver bot training, Facebook/Instagram inbox and an isolated Hermes integration.
**Architecture:** Preserve the modular NestJS backend and feature-based React frontend. Python/Hermes is isolated behind an authenticated versioned bridge. All delivery and tenant authorization remain in NestJS.
**Tech Stack:** TypeScript, NestJS, React, Drizzle/PostgreSQL, Python/Hermes, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-10-24-training-meta-inbox-design.md

## Global Constraints

- Scope only bot training, channel connection and inbox; keep other developers' modules stable.
- All business data is workspace scoped; no plaintext tokens, production sends in tests or copied customer conversations.
- English code/docs/tests, vi/en translation catalogs, existing UI tokens and shadcn components.
- Preserve existing API and model routing unless explicitly selecting Hermes.
- No claim of live provider acceptance based on mocks.

## Task 1: Training UI and data

Files: apps/web/src/features/{bot,knowledge,ai}, apps/web/src/routes/app/bots, packages/i18n; existing backend bot/knowledge modules for added training resources.
Interfaces: existing bot/FAQ/playground contracts; additive training resources with explicit bot ownership checks.
- [x] Read reference screens and existing components.
- [x] Add tests for CRUD validation and workspace separation before implementation.
- [x] Implement persistent scenarios, quick replies and history with matching UI.
- [x] Verify targeted tests and browser behavior.

## Task 2: Meta channels and conversations

Files: generated channel/conversation backend modules, packages/channels, packages/contracts, packages/db migrations, matching web features/routes.
Interfaces: channel list/connect/callback/bot binding; conversation list/detail/messages/update; signed webhook receiver.
- [x] Reuse source connector semantics within host authentication and persistence.
- [x] Test token sealing/state replay/webhook signature and duplicate processing.
- [x] Implement scoped inbox CRUD, send state and human takeover.
- [x] Verify HTTP tests including validation, denied and cross-tenant cases.

## Task 3: Hermes bridge

Files: services/hermes runtime, existing ai module/ai-core ports, runtime documentation/ADR.
Interfaces: authenticated POST /v1/reply with bounded explicit context; reply and usage response; no delivery ability.
- [x] Inspect Hermes bridge and available runtime APIs.
- [x] Test malformed/unauthorized requests, timeouts, missing auth and model output with fake transport.
- [x] Add bridge/client and explicit provider configuration.
- [x] Verify the adapter and document setup without reading real auth files.

## Task 4: Integration and QA

Files: integration wiring, docs and task tracking; tests colocated with modified behavior.
- [x] Run pnpm check and focused browser QA.
- [ ] Review complete diff in fresh context against scope and invariants.
- [ ] Fix important findings and rerun covering checks.
- [ ] Record concrete evidence and outstanding live-account acceptance.
