---
id: T-030
title: CRM typed contact filters, table preferences and saved views
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [CRM-01, CRM-10]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-029-m3a-crm-core
pr:
parent:
---

## Context

GitHub #27, child of the CRM and statistics epic #25 (BA analysis of 2026-10-24). Milestone M3a "CRM core" ships the BA's delivery steps 1–2.

## Goal

CRM typed contact filters, table preferences and saved views.

## Scope

- Versioned filter AST (all/any, typed operators per field kind, duplicate-phone switch) compiled once in SQL for rows and totals.
- Sort with id tie-break; page/total from the same query.
- Saved views: private/shared, owner-only edits, version checks.
- Web: filter builder, view picker (save/update/delete), column show/hide/reorder per browser.

## Acceptance criteria

- [x] Name contains returns only matching fixtures (C07).
- [x] All vs Any give different correct cohorts; empty and negative operators covered (C08).
- [x] Duplicate phones group normalized equivalents, never empty phones.
- [x] A private view is invisible to another member (404); shared views are owner-editable only.
- [x] Column changes are a per-browser preference, not shop data.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated

## Log

- 2026-10-24 — created from GitHub #27; done. Verified with `apps/backend/test/crm.integration.spec.ts` and `apps/web/e2e-live/crm.spec.ts`.
