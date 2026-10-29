---
id: T-130
title: Redesign business creation and template based settings
status: in-progress
type: feature
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: fix/T-126-web-acceptance
pr:
parent: T-093
---

## Context

Owner found no create-business action, contradictory business names, confusing industry/free-text fields and native vertical arrows in settings navigation. Requested a simpler business/template design using TinyMind retail and Villas lodging examples.

## Goal

Provide a clear creation flow and one coherent settings form for the selected business.

## Scope

Creation entry point in the existing business selector; canonical business name; structured industry template and offering-specific fields; settings navigation overflow.

## Out of scope

New sidebar structure, changes to inbox, automatic live data conversion, account billing and new booking engines.

## Acceptance criteria

- [x] Inspect current implementation and document concrete design and model boundaries.
- [ ] Implement the reviewed design against authorized account ownership APIs.
- [ ] Independently QA creation, template context, rename consistency, roles, responsive overflow and unsaved data.
- [ ] Required checks pass; update behavior documentation with implementation.

## Plan

1. Document creation/settings flows, existing source/cache issues and template versus offering semantics.
2. Build a reviewable UI increment with two required creation inputs and one settings save action; preserve scoped navigation and current data.
3. Refresh every business-name consumer after rename; keep industry changes separate from cosmetic settings edits.
4. Add meaningful regressions, independent QA and final required checks on the implemented baseline.

## Log

- 2026-10-29 — Design stage started at owner request. Proposal saved in docs/business/business-settings-creation.md. No settings/business source change or live account mutation yet. Keep implementation separate from T-126 acceptance fixes and respect account foundation 0859328.

## Links

- docs/business/business-settings-creation.md
- T-093, T-079, T-126
