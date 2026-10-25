---
id: T-068
title: Redesign the sales inbox workspace
status: in-progress
type: feature
priority: P1
owner: "@agent:codex"
feature_ids: [CHAT-01]
created: 2026-10-25
updated: 2026-10-25
branch: feat/T-068-sales-inbox
pr:
---

## Context

The owner approved a sales-first inbox redesign based on Preny and Diro references and requested independent QA. Other agents are active; implementation uses an isolated worktree based on origin/main.

## Goal

Deliver a convenient sales workspace with actionable queues, reliable conversation drafting, customer context and order creation alongside chat.

## Scope

- Conversation list, header, composer, customer/order panel and supporting existing API integrations.
- English and Vietnamese translations, meaningful behavior tests, documentation and independent QA.

## Out of scope

- New channel providers, shipping integrations and automated reminders without an existing backend.
- Other agents' uncommitted work and shared tooling configuration.

## Acceptance criteria

- [ ] Sales queues and channel filters accurately describe available data.
- [ ] Composer drafts survive switching conversations; quick replies preserve existing text.
- [ ] AI takeover state and customer context are clear.
- [ ] Orders can be created alongside chat using existing commerce contracts.
- [ ] Loading, error, restricted sending and narrow layouts remain usable.
- [ ] Independent QA reviewed and material findings resolved.
- [ ] Meaningful tests and pnpm check pass; documentation updated.

## Plan

1. Inspect current conversation, CRM and commerce contracts; reuse existing feature boundaries.
2. Implement list/queue improvements and compose/customer/order workflows in separate owned files.
3. Add translations and regression tests for drafts, queues and order behavior.
4. Exercise responsive layouts, run pnpm check and independent QA, then prepare PR.

## Log

- 2026-10-25 — Owner approved brainstorming. Isolated worktree created from origin/main; no edits to other agents' workspace.

## Links

- [Screen design](../docs/03-screens-and-routes.md)
- [Meta inbox](../docs/meta-inbox.md)
- [Architecture](../docs/ARCHITECTURE.md)
