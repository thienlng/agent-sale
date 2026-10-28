---
id: T-078
title: Add account persistence and bot attribution with safe backfills
status: in-progress
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-28
branch: feat/T-077-account-foundation
pr:
parent:
---

## Context

The current runtime has workspaces with industry and business profile fields, but no first-class shop hierarchy. Adding hierarchy affects every scoped module.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Add account persistence and bot attribution with safe backfills.

## Scope

- Add `accounts` and `account_members`, and give `workspaces` an `account_id`. Back-fill one account per current workspace owner and report any ambiguous ownership.
- Signup creates the account, then the business. Creating a business places it under an account the user manages. Business access stays on `members` and RLS.
- Attribution: conversations carry the bot currently answering them; outbox events and analytics facts carry the bot at event time. Channel ↔ bot consistency (same workspace) is enforced in the database.
- A repeatable dry-run reconciliation command; documented rollback boundaries.

## Out of scope

- Subscription/quota move (T-091), business switching UI (T-079), bot catalog selection (T-080), UI redesign.

## Acceptance criteria

- [ ] Every existing workspace belongs to exactly one account after backfill. Bots, channels, conversations, contacts, orders and subscriptions stay reachable. Unresolved ownership is reported, never guessed.
- [ ] Cross-account and cross-business IDs are rejected. A channel cannot be bound to a bot of another workspace.
- [ ] Reassigning a page to another bot keeps past facts attributed to the old bot. Statistics can be filtered by bot.
- [ ] Migration and backfill are repeatable and backward compatible; rollback boundaries are documented.
- [ ] Cross-tenant integration tests; `pnpm check` passes; docs updated.

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 4 person-days (was 6: no shop entity).
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

Follows ADR-012 §8. Same branch as T-077 (block A1). Catalog selection columns (`bots.catalog_mode`, `bot_products`) are left to T-080, which owns that behavior.

1. **Expand migration `0028_accounts_and_bot_attribution.sql`** (additive, small tables only):
   - global `accounts` and `account_members` (app_system only);
   - nullable `workspaces.account_id` → `accounts`;
   - unique `bots(workspace_id, id)`;
   - `channel_connections` (workspace_id, bot_id) → `bots(workspace_id, id)` `ON DELETE SET NULL (bot_id)`, `NOT VALID`;
   - nullable `conversations.bot_id` (same composite key) and `analytics_facts.bot_id` (no key: history).
   - Drizzle schema mirrors it. An integration test proves a channel cannot point to another workspace's bot.
2. **`account` module** (`pnpm gen module account`, tier 1):
   - facade `resolveForNewBusiness({ userId, accountId?, name })`;
   - `CreateWorkspaceHandler` stores the account. Signup and `POST /workspaces` therefore both place the business under an account the user owns (ADR-012 §3).
3. **Backfill `account-backfill [--dry-run]`** (operator CLI, idempotent):
   - one account per owner user, `account_id` on every workspace;
   - `bot_id` on conversations and facts from the current binding;
   - unbind channels whose bot is missing or foreign;
   - a printed report of what it did not guess.
   - Integration test with a seeded legacy install, run twice.
4. **Attribution at event time:**
   - `botId` on `message.received` / `reply.completed` payloads and in `analytics_facts`;
   - `conversations.bot_id` set when a conversation is written and when a page is rebound;
   - `bots` filter on conversation metrics, with an RLS cross-tenant test.
5. **Docs:** ADR-004 amendment, docs/05, docs/analytics.md, the module's MODULE.md, `docs/ARCHITECTURE.md` tier table. Then run the gate.

## Log

- 2026-10-28 — Started on `feat/T-077-account-foundation` (block A1) after the maintainer asked to proceed; ADR-012 is still Proposed.
- 2026-10-28 — Replanned for lane A, now owned by @agent:claude (user decision, 2026-10-28). Product model agreed with the user: account → business (workspace) → bot → channels. **No separate shop entity**: the bot is the selling unit. The catalog is business-owned and each bot chooses which products it sells. Billable unit: an AI reply delivered to the customer, counted once across retries. When the allowance is exhausted, the bot stops and hands off to staff. Business switching lives in the avatar (account) menu. Code inventory and re-estimate: see the handoff's "Lane A replan" section.

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)
