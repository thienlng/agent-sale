---
id: T-053
title: Billing foundation: plans, subscriptions and entitlements
status: review
type: feature
priority: P1
owner: @agent:claude
feature_ids: [ADM-05]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-053-m4a-admin-foundation
pr:
parent:
---

## Context

Seat limits (ADM-01) and later plan/credit features (ADM-05..07) need to know what a shop is entitled to. Source: GitHub epic #43, docs/08-billing-quota-credit.md.

## Goal

A minimal billing module resolves a workspace entitlements from its plan and operator overrides.

## Scope

- Global `plans` seeded with free / sales_smart / sales_pro / sales_neo; tenant `subscriptions` and `workspace_entitlement_overrides` (migration 0015).
- `billing` module: entitlements = plan ⊕ unexpired overrides (null = unlimited, missing = 0), 60 s plan cache, `GET /billing/entitlements`.
- Operator CLI `workspace-plan set|show <owner-email> <plan> [months]`.

## Out of scope

- Payments, invoices, credit wallets — T-059, T-060.

## Acceptance criteria

- [x] Free plan has 1 member seat; a paid plan raises it; an expired override stops counting.
- [x] Entitlements are readable only for the caller workspace (RLS).
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (docs/08, billing MODULE.md)

## Log

- 2026-10-24 — created, implemented in milestone M4a; verified with unit, integration and live e2e tests.
