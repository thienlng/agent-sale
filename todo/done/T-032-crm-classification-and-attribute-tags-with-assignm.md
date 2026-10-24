---
id: T-032
title: CRM classification and attribute tags with assignments
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [CRM-07]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-029-m3a-crm-core
pr:
parent:
---

## Context

GitHub #29, child of the CRM and statistics epic #25 (BA analysis of 2026-10-24). Milestone M3a "CRM core" ships the BA's delivery steps 1–2.

## Goal

CRM classification and attribute tags with assignments.

## Scope

- Tag definitions (classification / attribute / work) with color, description, field schema (text, number, date, select, boolean), additive schema evolution, archive.
- Assignments scoped to contact (conversation scope reserved), idempotent add/remove, server-side value validation, schema version per assignment.
- Web: tag manager with field editor; tag picker, values dialog and chips in the drawer and list.

## Acceptance criteria

- [x] A classification tag is created and attached; the chip is there after reload (C11).
- [x] Retried add/remove do not duplicate assignments or events.
- [x] Missing or wrong-type required values are rejected.
- [x] Contact and conversation scopes are distinct in the API.
- [x] Archived options and tags stay readable on existing assignments.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated

## Log

- 2026-10-24 — created from GitHub #29; done. Verified with `apps/backend/test/crm.integration.spec.ts` and `apps/web/e2e-live/crm.spec.ts`.
