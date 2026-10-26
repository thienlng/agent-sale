---
id: T-076
title: Reduce integration initial bundle below 250 KB
status: backlog
type: chore
priority: P1
owner: "@unassigned"
created: 2026-10-26
updated: 2026-10-26
branch:
pr:
---

## Context

During T-075 font verification, pnpm check passed lint, architecture, typecheck and all tests, but the integration web build exceeded the initial bundle budget: 257.0 KB gzip versus 250 KB. Vite compilation itself succeeded. The primary checkout passed its full gate. The integration checkout includes additional application features; the origin of the extra bundle size has not been isolated.

## Goal

Restore the existing initial-load budget without weakening its check.

## Scope / Out of scope

Inspect initial imports and code splitting in the integration web app. Preserve functionality and the 250 KB budget; do not alter unrelated backend behavior.

## Acceptance criteria

- [ ] Initial web bundle is at most 250 KB gzip.
- [ ] pnpm check and relevant browser smoke tests pass.

## Plan

## Log

- 2026-10-26: Created from actual integration check output recorded in /tmp/t075-fraunces-check-rerun.log.

## Links

- docs/16-performance-and-scale.md
- todo/T-075-apply-fraunces-across-the-running-application.md
