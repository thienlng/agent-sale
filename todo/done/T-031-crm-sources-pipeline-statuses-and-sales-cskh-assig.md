---
id: T-031
title: CRM sources, pipeline statuses and Sales/CSKH assignment
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [CRM-08, CRM-09]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-029-m3a-crm-core
pr:
parent:
---

## Context

GitHub #28, child of the CRM and statistics epic #25 (BA analysis of 2026-10-24). Milestone M3a "CRM core" ships the BA's delivery steps 1–2.

## Goal

CRM sources, pipeline statuses and Sales/CSKH assignment.

## Scope

- Sources (7 defaults) and statuses (8 defaults): create, rename, recolor, reorder, archive/restore.
- Separate Sales and CSKH owners; only active members can be assigned; assignment history and events.
- Web: CRM settings tabs (statuses, sources), pipeline strip in the drawer.

## Acceptance criteria

- [x] Source/status change persists in detail and list with one audit entry.
- [x] Sales and CSKH can differ; a removed member cannot be assigned.
- [x] Archiving a referenced source keeps existing customers and history intact.
- [ ] Auto-assignment distribution policies → T-033.
- [x] Status changes never touch orders.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated

## Log

- 2026-10-24 — created from GitHub #28; done. Verified with `apps/backend/test/crm.integration.spec.ts` and `apps/web/e2e-live/crm.spec.ts`.
