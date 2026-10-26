---
id: T-056
title: Workspace business profile and private logo (ADM-02)
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [ADM-02]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-053-m4a-admin-foundation
pr: 53
parent:
---

## Context

GitHub #45. The shop needs a business profile and a private logo.

## Goal

Owners and admins edit the shop profile and manage a logo that is never publicly addressable.

## Scope

- Profile columns and `workspace_assets` (migration 0017, bytea, png/jpeg ≤ 1 MiB, RLS).
- Optimistic versioning, audit, idempotent upload by sha256, validation from the image bytes (square, 128–2048 px).
- Logo served with nosniff, CSP and ETag/304 on an authorised route.
- Web: Settings → Hồ sơ shop with unsaved-changes guard.

## Out of scope

- Object storage for logos (T-013) — bytea is enough at this size.

## Acceptance criteria

- [x] A non-square, oversized or corrupt image is refused with a specific reason.
- [x] A stale save is a CONFLICT and reloads the latest.
- [x] Another shop cannot read the logo.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (workspace MODULE.md, docs/02 ADM-02)

## Log

- 2026-10-24 — created, implemented in milestone M4a; verified with unit, integration and live e2e tests.
