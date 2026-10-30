---
id: T-156
title: Reset TinyMind and Villas conversation history
status: done
type: chore
priority: P1
owner: agent:codex
feature_ids: []
created: 2026-10-30
updated: 2026-10-30
branch: feat/T-155-villas-a17-business
pr:
---

## Context

The owner requested a fresh chat test for TinyMind and Tam Dao Villas Central and will clear the Meta side themselves.

## Goal

Clear conversation and AI execution history for exactly the two selected businesses.

## Scope

Conversation documents/messages, AI/action runs, pending actions, webhook payload history, chat analytics, conversation outbox events, and linked webchat visitor history.

## Out of scope

Catalog, inventory, training content/history, bot configuration, channel bindings, CRM contacts/settings, orders/stays, billing and configuration audit trail. No Meta API writes.

## Acceptance criteria

- [x] Target chat history is empty after the transaction.
- [x] Preserved tables and other workspaces are unchanged.
- [x] Record aggregate counts only; keep any recovery copy outside the repository.

## Plan

1. Verify workspace names, table references and pending processing.
2. Back up affected rows privately, then delete explicit workspace-scoped records in one transaction.
3. Verify zero target history and unchanged preserved data; record results. No application code or schema changes, so no code test gate is needed for this operational reset.

## Log

- 2026-10-30 — Verified local database rapiz_acceptance, exact workspace IDs, six conversations and 45 messages; no pending webhook deliveries. Preserve non-conversation outbox events and configuration audit trail.

## Links

- Related: T-153, T-155.

- 2026-10-30 — Completed in one transaction: removed 6 conversations, 45 messages, 233 AI runs, 29 action runs, 68 webhook records, 177 chat analytics facts and 440 conversation outbox events. All target chat tables read back empty. Full content hashes verified 15 preserved tables and all unrelated workspace rows unchanged. Private recovery copy is outside the repository with directory mode 0700 and file mode 0600. No application code, schema, Meta data or credentials changed.
