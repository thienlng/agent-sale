---
id: T-091
title: Move subscription and message quota ownership to the account
status: review
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-29
branch: feat/T-124-integrate-lane-a3
pr: 85
parent:
---

## Context

Existing integration subscriptions are workspace-scoped. The new commercial direction uses one message allowance across all businesses and no business/shop/bot quantity limits.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Move subscription and message quota ownership to the account.

## Scope

- Implement approved account subscription ownership, versioned plan entitlements and aggregated per-cycle billable message usage across owned businesses.
- Define billable event, cycle timezone/reset, retries/idempotency, concurrent quota reservation/capture/release, exhaustion behavior and reconciliation.
- Make message allowance the commercial capacity dimension: remove business/bot quantity caps and inventory inherited staff/contact/training/storage entitlements so old commercial limits do not silently contradict the new package policy. Keep operational validation, pagination and rate protection; explicitly document any separately agreed exception.
- Migrate existing subscriptions/counters with explicit handling for multiple paid workspaces and shared business members; preserve financial history.

## Out of scope

- New payment gateways, invoices T-059, wallets/vouchers T-060; overage/top-up is pending product policy.

## Acceptance criteria

- [x] Two businesses consume one account allowance without double-counting provider retries; concurrent sends cannot exceed the approved quota semantics.
- [x] Boundary, failure, reset and exhaustion tests pass; manual/handoff behavior at exhaustion matches the approved commercial policy.
- [x] Creating additional businesses, shops or bots is not blocked by quantity entitlements; existing subscription migration reconciles before/after totals.
- [x] Update billing/tenancy design and ADRs; do not reinterpret or rewrite historical ledger entries.
- [x] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [x] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 7–9 person-days (no message metering exists today; `ai_runs` over-counts retries).
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

1. **Schema (migration 0031).** Add `account_subscriptions`, `account_entitlement_overrides` and `message_usage`, reachable through app_system only.
2. **Resolution.** Billing resolves the account subscription and its overrides first, then falls back to the business's subscription, then to `free`. The account of a business comes from the new workspace facade `accountOf`.
3. **Meter.** Reserve under a per-account advisory lock, capture when the reply is `sent`, release on failure. A reservation expires after 15 minutes. The key is the outbound idempotency key.
4. **Wiring.** Wire the meter into `MetaInboxProcessor` (Messenger, Instagram, website) and `FanpageCommentProcessor`. When the allowance is exhausted, hand off to staff (comments go to staff review).
5. **API and UI.** Add `GET /billing/usage` and a dashboard banner (vi/en).
6. **Backfill.** The `account-backfill` CLI copies each account's paid workspace subscription to the account (most expensive plan wins), reports conflicts and never changes workspace subscriptions.
7. **Inventory.** Inventory the inherited plan keys; nothing new is enforced or removed.

## Log

- 2026-10-28 — Implemented (migration 0031, billing meter, conversation wiring, `GET /billing/usage`, banner, subscription backfill).
  - Decisions are in ADR-012 §5 implementation notes and docs/08 §4a:
    - free cycles use a fixed anchor at Vietnam midnight;
    - a delivery that ends unknown is not counted after 15 minutes;
    - fanpage comment replies are billed;
    - a business without an account is unmetered;
    - a plan without `ai.included_messages` allows 0 replies.
  - No business, shop or bot quantity caps exist to remove. Only `members.max` is enforced, and it is kept.
  - The integration test found that raw `Date` parameters in `sql` templates crash postgres-js; fixed with typed operators.
  - Tests:
    - `packages/db/src/account-billing.integration.test.ts`
    - `apps/backend/test/billing-usage.integration.spec.ts`
    - billing and processor unit tests
    - banner component test

- 2026-10-28 — Replanned for lane A, now owned by @agent:claude (user decision, 2026-10-28). Product model agreed with the user: account → business (workspace) → bot → channels. **No separate shop entity**: the bot is the selling unit. The catalog is business-owned and each bot chooses which products it sells. Billable unit: an AI reply delivered to the customer, counted once across retries. When the allowance is exhausted, the bot stops and hands off to staff. Business switching lives in the avatar (account) menu. Code inventory and re-estimate: see the handoff's "Lane A replan" section.

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.
- 2026-10-29 — Rebuilt on main under T-124 (A3), on top of the A2 block (PR #84).

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)
