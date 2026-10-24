---
id: T-023
title: Edit items and quantities on existing orders
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [ORD-03, ORD-05]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-023-orders-parity-fixes
pr:
parent:
---

## Context

GitHub issue #16 (RZ-ORD-001, testing agent): the order detail could only edit shipping, payment received and notes; the reference product lets staff change quantities (order #0001 edited from 2 to 3).

## Goal

Staff can change the products, quantities, prices and payment of an order while its goods are still held, with stock and totals following.

## Scope

- `PATCH /orders/{id}` accepts `items` plus discount, shipping charged, free shipping and surcharge; amounts are recomputed with the shared formulas.
- Lines can change only while `stock_state = reserved`; otherwise 409 and nothing is written.
- The reservation moves by the per-variant difference; kept lines keep their snapshot price, new lines must be on sale and take the catalog price.
- Order detail: "Sửa sản phẩm" editor (product picker, lines, payment) and an editable customer/delivery panel.

## Out of scope

- Editing lines after the goods left the warehouse (needs return/exchange flows).
- Per-member permissions (every workspace member may edit orders today; roles come with the CRM/team milestone).

## Acceptance criteria

- [x] New order reserving 2 of 10, edited to 3: reserved 3, available 7, still one order, totals recomputed (integration + live e2e).
- [x] Shipped order: line edit refused with 409, no partial change (integration).
- [x] Concurrent edits leave the reservation equal to the final lines; another shop gets 404 (integration).
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (commerce MODULE.md)

## Log

- 2026-10-24 — created from #16; done. Verified with `test/commerce.integration.spec.ts` and `e2e-live/commerce.spec.ts`.
