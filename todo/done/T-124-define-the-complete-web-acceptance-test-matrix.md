---
id: T-124
title: Define the complete web acceptance test matrix
status: done
type: docs
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: docs/T-124-web-acceptance-matrix
pr: none (local documentation delivery for owner review)
parent: T-094
---

## Context

The owner approved a live TinyMind/Messenger acceptance approach, but requested deeper cases that verify every visible statistic and inbox control with independent evidence rather than superficial before/after checks.

## Goal

Produce a reviewable, executable web acceptance pack grounded in the current main baseline.

## Scope

- Document live Messenger-to-Rapiz workflows, bot/human control, inbox actions, CRM context, statistics, navigation, landing and responsive behavior.
- Specify datasets, steps, exact assertions, independent oracles, cleanup, priorities and execution records.
- Separate live-safe, isolated, permission-gated and deferred checks.

## Out of scope

- Executing the new pack, changing application code, external sends, customer mutations or claiming full acceptance.
- Integrating cofounder branches or deciding unresolved product formulas.

## Acceptance criteria

- [x] Every case has a stable ID, prerequisites/data, steps, expected results, oracle and cleanup.
- [x] All 12 current statistics metrics have individual cases and explicit formulas.
- [x] Inbox control inventory maps visible actions to cases and documents unavailable capabilities.
- [x] A deterministic statistics dataset has manually calculated expected results, including temporal and distinct semantics.
- [x] An execution ledger starts with NOT_RUN for every case; earlier automated results are not substituted.
- [x] Documentation links, formatting and scenario coverage are checked; pnpm check result is recorded honestly.

## Plan

1. Read the current UI, contracts and business documentation; record the baseline and conflicts.
2. Author an indexed acceptance pack with shared fixture and evidence conventions, detailed cases and a control map.
3. Generate the execution ledger and validate unique IDs, links, case fields and metric coverage.
4. Review edge cases and dataset arithmetic, run documentation formatting and the repository gate, and report the saved files for owner review.

## Log

- 2026-10-29 — Created and claimed for documentation only; baseline main b0f1be6. No new live test or customer action is authorized by this document-writing task.

- 2026-10-29 — Authored 116 cases across 13 case families, a 12-metric coverage table, independently calculated G-A/G-B fixtures, explicit per-case source oracles/cleanup and a 116-row NOT_RUN execution ledger. Indexed from docs/README.md.
- 2026-10-29 — Independent same-model agent QA accepted the final specification. Resolved findings: channel-first-phone creation origin versus later manual-update origin, non-vacuous bot terminal outcomes, positive lead-notification path/priming/max-three behavior, phone copy/link controls and optional bug IDs for clean PASS records. This approves the plan, not product execution.
- 2026-10-29 — Validation passed: 116 unique complete case IDs, all required fields, 116 matching NOT_RUN ledger rows, valid local links/case anchors and all 12 current metric keys mapped. Prettier and git diff whitespace checks passed.
- 2026-10-29 — pnpm check passed (lint, architecture, typecheck, tests and build; final build13/13 successful,12 cached). Three existing max-lines warnings remain. Initial gate encountered two ignored generated browser YAML captures with formatting issues; preserved them outside the repository at /tmp/t124-browser-snapshot-archive and reran the unchanged gate. No product source, tests, assertions, timeout or tooling configuration changed.
- 2026-10-29 — No live messages, customer mutations or case executions performed while writing this pack. All planned case statuses remain NOT_RUN; files saved for the owner's review.

## Links

- docs/analytics.md
- docs/18-sales-inbox-workspace.md
- docs/handoffs/2026-10-28-lane-b-closeout.md
- Related tasks: T-094, T-042, T-122
