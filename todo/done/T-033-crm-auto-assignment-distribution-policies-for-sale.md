---
id: T-033
title: CRM auto-assignment distribution policies for Sales and CSKH
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [SET-02, CRM-01]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-043-m3b-team-access
pr:
parent: T-029
---

## Context

The remainder of GitHub #28 (CRM-03): distributing new customers to Sales automatically.

## Goal

New customers from a source are handed to the chosen Sales members by weight.

## Scope

- `crm_assignment_policies` per source (enabled, candidates with weights 1–10, cursor, version); weighted round robin with the policy row locked while picking; removed members skipped; customers created with a Sales owner untouched.
- History entry flagged `autoAssigned`, `crm.contact.assigned.v1` event.
- Web: "Phân chia khách" tab in customer settings.

## Out of scope

- Distribution by page (needs channels) and ratio by day; CSKH auto-assignment.

## Acceptance criteria

- [x] Six concurrent creates with weights 2:1 give exactly 4 and 2.
- [x] A removed member stops receiving customers.
- [x] Stale policy save answers 409; non-members are rejected.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated

## Log

- 2026-10-24 — done in M3b.
