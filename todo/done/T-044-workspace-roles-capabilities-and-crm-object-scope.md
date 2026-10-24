---
id: T-044
title: Workspace roles, capabilities and CRM object scope
status: done
type: feature
priority: P0
owner: @agent:claude
feature_ids: [SET-02]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-043-m3b-team-access
pr:
parent: T-042
---

## Context

The CRM part of GitHub #38 (PLATFORM-01), split from T-042: roles with capabilities and per-object scope for customers.

## Goal

What a member can do follows their role, on the server and in the UI.

## Scope

- Roles owner/admin/sales/care/analyst; `ROLE_CAPABILITIES` in contracts shared by server and web; `@RequireCapability()` checked by the auth guard (403); legacy role names mapped in migration 0007.
- Routes annotated across bots, catalog, orders, order settings, CRM settings, customers and views.
- Customer scope: Sales/CSKH see their own and unassigned customers (404 otherwise); owner changes need `contacts.assign` except claiming an empty slot; sharing views needs `views.share`.
- Web: `useCan`, hidden settings links and add buttons, read-only customer drawer, owner pickers limited to yourself without assign.

## Out of scope

- Custom roles (SET-03), page/source-scoped visibility, entitlements and the BA acceptance suite — still in T-042.

## Acceptance criteria

- [x] Sales cannot create products, CRM settings or bots; analysts cannot create customers or orders.
- [x] Sales see only their own and unassigned customers, in the list and every detail endpoint.
- [x] Claiming works; reassigning to someone else is 403; sharing a view is 403 for Sales.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (crm MODULE.md, docs/02 SET-02)

## Log

- 2026-10-24 — created and done.
