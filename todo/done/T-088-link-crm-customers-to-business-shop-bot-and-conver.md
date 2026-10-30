---
id: T-088
title: Link CRM customers to bots and conversations
status: done
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-30
branch: feat/T-124-integrate-lane-a3
pr: 85
parent:
---

## Context

CRM already supports profiles, filters, statuses and tags. The review asks for bot linkage and coherent navigation with inbox; full reference-product parity is not sufficiently specified.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Link CRM customers to bots and conversations.

## Scope

- Define customer identity/deduplication at the approved business boundary and model potentially multiple bot/channel relationships through conversations.
- Add bot CRM filters and bidirectional navigation between contact records and conversations.
- Synchronize shared profile/status/tag mutations and cache refresh; handle unassigned channels and reassignment history without duplicating customers.

## Out of scope

- Unspecified CRM reference parity, import/merge engine T-036, files T-037, advanced automation T-038.

## Acceptance criteria

- [x] A customer who contacts two pages follows the approved deduplication policy and their authorized conversations are discoverable from CRM.
- [x] Inbox-to-CRM and CRM-to-inbox navigation retain business scope; bot filters return the expected customers.
- [x] No cross-business customer identity leak or unauthorized relation is possible; historical bot associations survive reassignment as specified.
- [x] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [x] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 4–5 person-days (Meta conversations have no stored contact link yet) including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078, T-080
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

Deduplication policy: **one phone number = one customer per business** (E.164, the existing CRM normalization and per-phone lock). No matching by name, no cross-business identity. Bots are a relation, not part of identity.

1. Migration 0030 (additive): `conversations.contact_id` with a composite key to `contacts(workspace_id, id)` (`ON DELETE SET NULL (contact_id)`); `contact_bots(workspace_id, contact_id, bot_id, first_seen_at)` with forced RLS, no key to `bots` (history survives rebinding and bot deletion); backfill from `data.lead.contactId`.
2. `crm`: `recordContactBot`; `upsertLeadByPhone` accepts `facebook` / `instagram` sources; filter field `botId` (`has_any`, `has_none`) on `contact_bots`.
3. `conversation`: `contactId` on the DTO (column-owned like `botId`); `PUT /conversations/{id}/contact` (`contacts.edit`, customer checked through crm); automatic link after a stored Facebook/Instagram message with a phone (best effort, never replaces a link); `linkLead` sets the link; the bot is recorded on link and on a change of answering bot; `GET /conversations?contactId=`.
4. Web: the inbox panel uses the stored link (change, unlink, open in CRM); `/app/inbox?conversation=` deep link; a Conversations tab in the CRM profile composed in routes; "Bot" customer filter.
5. Tests: integration (two pages one phone → one customer, bot filter across rebind, permissions, cross-business 404), migration backfill test, web component tests. Docs: docs/05, docs/18, docs/meta-inbox, crm and conversation `MODULE.md`.

## Log

- 2026-10-28 — Implemented (block A3). Migration 0030, crm `recordContactBot` and the `botId` filter, conversation `contactId`/`PUT …/contact`/automatic phone link, web panel, deep link, profile Conversations tab and Bot filter. Backend integration `inbox-v2`, `webchat`, `crm` green; db `conversation-contacts` green; web unit tests green. Notes for review: the automatic link runs in its own transactions after the message is stored (crm owns its tables), so a crash between the two leaves the conversation unlinked until the next message; contacts are never hard-deleted today, so `ON DELETE SET NULL` is a safety net only. Staff-corrected phones (`PATCH customerPhone`) do not auto-link; staff link the customer directly.
- 2026-10-28 — Replanned for lane A, now owned by @agent:claude (user decision, 2026-10-28). Product model agreed with the user: account → business (workspace) → bot → channels. **No separate shop entity**: the bot is the selling unit. The catalog is business-owned and each bot chooses which products it sells. Billable unit: an AI reply delivered to the customer, counted once across retries. When the allowance is exhausted, the bot stops and hands off to staff. Business switching lives in the avatar (account) menu. Code inventory and re-estimate: see the handoff's "Lane A replan" section.

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.
- 2026-10-29 — Rebuilt on main under T-124 (A3), on top of the A2 block (PR #84).
- 2026-10-30 — merged to main (PR #85); closed in the version 1 close-out (T-158).

## Links

- [Review milestone handoff](../../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../../docs/08-billing-quota-credit.md)
