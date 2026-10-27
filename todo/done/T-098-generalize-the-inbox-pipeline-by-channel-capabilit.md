---
id: T-098
title: Generalize the inbox pipeline by channel capabilities
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [CHN-05]
created: 2026-10-27
updated: 2026-10-27
branch: feat/T-097-website-chat-channel
pr: direct merge to main (owner-approved, 2026-10-27)
parent: T-097
---

## Context

The inbox processor, conversation send window and channel deliver/presence assume a Meta adapter. A website channel has no 24 h window and delivers locally. Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`. Plan (Task 2): `docs/superpowers/plans/2026-10-27-website-chat-channel.md`.

## Goal

Drive the reply window and delivery from channel capabilities with no behavior change for Meta.

## Scope

- In scope: Channel capabilities and a website adapter in packages/channels
- In scope: Window checks in the processor and conversation send() by capability
- In scope: deliver()/presence() dispatch by provider (website: local mark sent)

## Out of scope

- Renaming MetaInboxProcessor or PendingMetaEvent (coordinator ruling)
- Website API and widget

## Acceptance criteria

- [x] Existing Meta inbox/channel tests pass unchanged
- [x] Capability-driven window check covered by tests
- [x] Website deliver() returns sent without a network call
- [x] pnpm check green
- [x] Docs updated (or "no docs impact" stated)

## Plan

See the plan section (Task 2) linked above.

## Log
- 2026-10-27: Added capabilitiesOf/withinReplyWindow (packages/channels), ChannelProvider contract, capability-driven window checks in the inbox processor and staff send, website branches in deliver/presence/fetchCustomerProfile; web types widened. Verified with new unit tests and pnpm check.

- 2026-10-27 — created.
- 2026-10-27: T-104 verification pass, set to review: capability-driven window and website delivery covered by unit and integration tests; Meta tests unchanged. `pnpm check` exit 0.
- 2026-10-27: merged into `main` (squash, owner-approved direct merge); status done.

## Links

- Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`
- Plan: `docs/superpowers/plans/2026-10-27-website-chat-channel.md`
- Docs: `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md`, `docs/07-channel-integrations.md` section 5
- Related tasks: T-097..T-104
