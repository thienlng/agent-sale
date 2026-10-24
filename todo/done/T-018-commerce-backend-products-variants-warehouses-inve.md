---
id: T-018
title: Commerce backend: products, variants, warehouses, inventory, orders, statuses, overview
status: done
type: feature
priority: P0
owner: @agent:claude
feature_ids: [ORD-01, ORD-02, ORD-03, ORD-04, ORD-05, ORD-11]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-015-m2-bot-playground (milestone M2)
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Owner request (2026-10-24): build the Orders area completely — overview, order list, product management — for review in the M2 PR. Spec: docs/02 ORD-*, docs/05 §6, Preny reference docs/reference/preny-dashboard-spec.md §4.

## Goal

A shop can keep its catalog and stock per warehouse, take orders with correct money and stock handling, move them through statuses, find them, and read sales figures.

## Scope

- Migration 0004 (10 tenant tables, forced RLS), contracts `commerce/*`, `commerce` backend module.
- Warehouses (default + many), products with variants (SKU, price, cost, weight), stock-take adjustments with a movement log, variant picker.
- Orders: create (docs/05 formulas), edit people/shipping/payment/notes, 14 statuses with optional ones and required notes, history with name snapshots, stock reserve/ship/release/return.
- List with status counts, accent-insensitive search, date/source filters, sort, page numbers, totals. Overview per local day (KPIs, closed/returned, series, today by hour).
- IdentityFacade.displayName; error code UNAVAILABLE.

## Out of scope

- Excel import, product images (T-013 storage), 2-level address picker (admin_units), carriers/shipments/Google Sheet/CAPI/printing, orders from chat, customers (CRM), editing order items.

## Acceptance criteria

- [x] Money formulas and stock transitions unit-tested; full lifecycle verified on Postgres (reserve → ship → refused cancel → return → stock restored).
- [x] List counts/search/totals and overview figures agree on the same data; another workspace sees nothing (RLS).
- [x] Duplicate SKU → 409; optional status off → 400; required note → 400.
- [x] `pnpm check` green; integration backend 12, db 9.

## Plan

Contracts + migration → domain (amounts, stock transitions, local time) → services → Drizzle store → controllers → integration tests → docs.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

- 2026-10-24 — done. Unit: amounts 5, stock 5, local time 4. Integration: 4 commerce scenarios on Postgres.

## Links

- Docs: …
- Related tasks: …
