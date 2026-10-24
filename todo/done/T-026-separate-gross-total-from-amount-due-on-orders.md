---
id: T-026
title: Separate gross total from amount due on orders
status: done
type: feature
priority: P2
owner: @agent:claude
feature_ids: [ORD-03, ORD-04]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-023-orders-parity-fixes
pr:
parent:
---

## Context

GitHub issue #22 (RZ-ORD-007): the list's "Tổng tiền" showed the amount due (265,000) while the reference product's "Tổng số tiền" is the gross before discount (285,000).

## Goal

Name both amounts and never reuse one ambiguous total.

## Scope

- `computeAmounts` returns `gross = subtotal + shipping charged + surcharge`; `total = gross − discount` ("Tiền cần thu").
- API `amounts.gross` and list `totals.gross`; list columns "Tổng số tiền" (optional) and "Tiền cần thu"; detail and form summaries show gross before the discount; CSV export follows the columns.

## Acceptance criteria

- [x] Fixture: subtotal 250,000, gross 285,000, discount 20,000, due 265,000, paid 100,000, COD 165,000 (unit test).
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (docs/05 formulas)

## Log

- 2026-10-24 — created from #22; done.
