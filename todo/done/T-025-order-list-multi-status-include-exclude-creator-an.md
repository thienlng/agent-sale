---
id: T-025
title: Order list multi-status include/exclude, creator and carrier filters
status: done
type: feature
priority: P2
owner: @agent:claude
feature_ids: [ORD-04]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-023-orders-parity-fixes
pr:
parent:
---

## Context

GitHub issue #19 (RZ-ORD-004): the status filter was single-choice and there were no creator or carrier filters.

## Goal

Operational filters for the order list.

## Scope

- `status=a,b` with `statusMode=include|exclude` (NOT IN), `createdBy`, `carrier`; OR within a filter, AND across filters; counts and footer totals use the same filters (counts ignore only the status filter, since they label its choices).
- `facets` in the list response: creators and carriers to choose from.
- Web: status checkboxes with counts and an exclusion switch; "Lọc thêm" menu for creator and carrier; all filters in the URL; the page resets on change.

## Out of scope

- Carrier dispatch-state filter: needs carrier integration (T-020).
- Selection across pages: selection stays per page and is cleared on any filter or page change.

## Acceptance criteria

- [x] Include/exclude, creator and carrier filters tested on Postgres.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (docs/02 ORD-04)

## Log

- 2026-10-24 — created from #19; done.
