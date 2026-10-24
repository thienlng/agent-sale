---
id: T-042
title: CRM and statistics permissions, entitlements and acceptance suite
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1
owner:                     # @github-handle or @agent:<tool>
feature_ids: [CRM-*, ANA-*]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #38. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Roles (Owner/Admin, Sales, CSKH, Analyst) with capabilities and object scope (assignment/source/page), entitlements, and the 32-case BA acceptance suite (C01–C20, A01–A12).

## Scope

- See GitHub #38 for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Cross-tenant/scope tests for list, detail, notes, history, files, facets, export, analytics; acceptance results report pass/fail/blocked.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: Needs team invitations (members other than the owner).

## Log

- 2026-10-24 — created from GitHub #38.
- 2026-10-24 — roles, capabilities and CRM customer scope shipped as T-044 (M3b); entitlements, page scope, analytics permissions and the BA acceptance suite remain.
