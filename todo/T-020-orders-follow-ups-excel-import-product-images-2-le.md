---
id: T-020
title: Orders follow-ups: Excel import, product images, 2-level address picker, carriers and printing, multi-tab drafts
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature
priority: P2
owner:                     # @github-handle or @agent:<tool>
feature_ids: [ORD-01, ORD-03, ORD-08, ORD-10, ORD-13]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Left out of the M2 orders area (T-018/T-019) on purpose; listed in their Out of scope.

## Goal

Close the remaining gaps with the reference product's order workflow.

## Scope

- Excel import of products (ORD-01).
- Product images (needs object storage, T-013).
- 2-level Province/Ward picker with `admin_units` data (docs/05 §6).
- Carrier connections, waybills and printing (ORD-08, ORD-13); Google Sheet sync (ORD-10).
- Multi-tab order drafts with F6 (ORD-03).
- Shipping policy per source and dispatch-state filter for the order list (from #19, #21).
- Split into separate tasks before starting.

## Out of scope

- …

## Acceptance criteria

- [ ] Each item has its own task with acceptance criteria before work starts.
- [ ] Product import: preview step; replace / add / ignore-stock modes; retry-safe commit (#21).
- [ ] Carriers: sandbox accounts in tests; no duplicate waybill when a request is retried (idempotency key); saving a draft never creates a shipment (#17, #21).
- [ ] Google Sheets sync keyed by a stable order key (order id), safe to re-run (#21).
- [ ] Printing distinguishes shop documents (invoice, packing slip) from carrier labels (#21).
- [ ] Until each lands, the UI does not show the feature as available.

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.
- 2026-10-24 — acceptance criteria from GitHub issue #21 (testing agent) added; #19's dispatch-state filter belongs here too.

## Links

- Docs: …
- Related tasks: …
