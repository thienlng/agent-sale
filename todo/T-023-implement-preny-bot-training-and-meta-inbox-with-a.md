---
id: T-023
title: Implement Preny bot training and Meta inbox with an isolated Hermes runtime
type: feature
status: in-progress
priority: P0
owner: agent:codex
branch: feat/T-023-training-meta-inbox
feature_ids: [BOT-01, BOT-07, CHAT-01]
---

## Context

The owner authorized a two-hour implementation window on 2026-10-24 after approving the functional split in chat. Keep Hermes/Python for AI, NestJS for platform data and channels. Reference the signed-in Preny UI using Chrome Profile 3 (Ken), existing research, booking-agent, and channel-payment-modules. T-022 is reserved by an existing remote branch; use T-023.

## Goal

Deliver reviewable bot-training and Meta inbox flows, with clear module boundaries and honest provider configuration states.

## Scope / Out of scope

In scope: bot training screens, scenarios/quick replies/media metadata, existing catalog integration, history, Facebook/Instagram connection and messaging, conversation ownership and human takeover, isolated Hermes bridge. Other channels show UI only. Existing CRM/commerce APIs are reused; missing integrations are presented honestly.
Out of scope: billing/payment implementation, new CRM/commerce domains, rewriting Hermes, automatic production deployment, claiming unperformed live consent or delivery acceptance.

## Acceptance criteria

- [ ] Bot training navigation, FAQ/scenarios/settings and playground are usable with persistent data.
- [ ] Facebook/Instagram connection and inbox use workspace-scoped APIs and expose actionable unconfigured states.
- [ ] Message send/webhook processing enforce validation, idempotency and human takeover.
- [ ] Hermes remains a private, replaceable runtime; no copied real tokens or customer logs.
- [ ] Other channels have informational UI without fake live connections.
- [ ] Relevant behavior/tenant tests and pnpm check pass; browser QA and independent review findings recorded.

## Plan

1. Record the approved architecture and contracts; inspect Preny and source implementations.
2. Build training data APIs and matching frontend navigation/forms within existing bot/knowledge modules.
3. Build channel and conversation modules with Meta adapters, encrypted tokens and scoped persistence.
4. Add isolated Hermes runtime/bridge and connect playground/conversation orchestration through ports.
5. Integrate frontend contracts, translations, browser states and existing catalog/order links.
6. Run targeted tests, pnpm check, browser QA and independent review; fix important findings.

## Log

- 2026-10-24: Scope and Hermes decision approved in chat. Owner authorized autonomous execution for two hours. Baseline pnpm check passed during onboarding. Existing source connector contains OAuth but no inbox; commercial subscription eligibility remains a provider constraint.

- 2026-10-24: Codex session hit its limit mid-integration. Resumed by Claude Code: fixed lint (type import, unused Badge), missing webhook `@agent-sales/db` install, exactOptionalPropertyTypes in S3 media storage, invalid LOG_LEVEL in meta-inbox HTTP test; recreated the local dev DB because 0005 was edited after being applied (500 on training-items until 0008 ran); marked inbox/channels nav items as ready. pnpm lint/arch/typecheck/test/build green (backend 290 tests, Hermes bridge 8 unittest). Owner asked to skip pixel-parity screenshot QA; acceptance is code/logic only.

## Links

- docs/ARCHITECTURE.md
- docs/06-ai-engine.md
- docs/07-channel-integrations.md
- docs/superpowers/specs/2026-10-24-training-meta-inbox-design.md
