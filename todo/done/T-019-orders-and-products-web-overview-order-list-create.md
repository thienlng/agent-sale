---
id: T-019
title: Orders and products web: overview, order list, create order, order detail, products, warehouses, order settings
status: done
type: feature
priority: P0
owner: @agent:claude
feature_ids: [ORD-01, ORD-02, ORD-03, ORD-04, ORD-05, ORD-11]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-015-m2-bot-playground (milestone M2)
pr:
parent: T-018
---

## Context

Owner request (2026-10-24): the complete Orders area in the M2 PR. Backend in T-018; Preny reference docs/reference/preny-dashboard-spec.md §4.

## Goal

Shop staff run the whole order workflow in the dashboard: catalog and stock, warehouses, create/find/handle orders, read sales figures — fast, responsive, vi/en.

## Scope

- Sidebar group "Đơn hàng" with Overview, Order list, New order, Products, Setup.
- Overview: date presets/range, 8 KPI cards switching the daily chart, closed/returned goods, today with revenue by hour.
- Order list: URL-kept filters (status tabs with counts, search, date range, source, sort, page), table with totals footer on desktop, cards on phones.
- New order: warehouse + product picker with stock, line editing, payment with live totals (shared `computeAmounts`), notes, details, customer, delivery, shipping; F2 submits.
- Order detail: items, amounts, people, editable shipping/payment/notes, status change (required notes), history timeline, stock state.
- Products: list (search, on sale/archived, pages), create/edit with variants, stock-take per warehouse. Setup: status settings, warehouses.
- Shared web pieces: MoneyInput, DateRangePicker, format helpers; shadcn calendar/chart/checkbox/collapsible/radio-group/pagination.

## Out of scope

- Multi-tab order drafts (F6), Excel import, product images, address picker, printing, bulk actions on orders.

## Acceptance criteria

- [x] Full flow verified against the local backend (warehouse → product + stock → order via F2 → confirm → list → overview with matching figures).
- [x] Responsive guard extended to 8 commerce pages at 375–1920 px with long content: no horizontal overflow; Playwright 10/10.
- [x] Initial bundle 198 KB gzip (budget 250); `pnpm check` green; Vitest 12.

## Plan

i18n → shared helpers → API hooks → components (list, form split into parts, detail, overview, products, settings) → routes → sidebar → tour with screenshots → e2e mocks → docs.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

- 2026-10-24 — order amounts moved to packages/shared so the form previews exactly what the server stores. Vite dev re-optimization (recharts/react-day-picker) caused a transient invalid-hook-call reload; fixed with optimizeDeps.include.
- 2026-10-24 — done.

## Links

- Docs: …
- Related tasks: …
