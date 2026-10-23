---
id: T-012
title: Record brand Razpi, white-orange theme and single maintainer
status: done
type: chore
priority: P0
owner: @agent:claude
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch: chore/T-012-brand-and-single-maintainer
pr:
parent:
---

## Context

Owner decisions (2026-10-23): no second maintainer for now; working brand name **Razpi**; visual identity white base with orange primary. The repo still referenced a second maintainer and a blue placeholder theme, and the board had stale titles.

## Goal

Repository reflects the decisions before feature work starts.

## Scope

- CODEOWNERS / AGENTS.md / docs/15 / ADR-009 deciders: single maintainer; "2 humans" policies become maintainer approval + fresh-context agent review.
- Brand: README title, i18n `app.name`, web `<title>` + `theme-color`, `packages/ui` tokens to white/orange.
- docs/14 A1 decided; T-002 updated; TODO.md stale titles fixed (T-004, T-005, T-010 PR ref).
- Package scope `@agent-sales/*` intentionally unchanged (the name may still change).

## Out of scope

- Logo, typography, full design system (part of T-005).

## Acceptance criteria

- [x] No remaining references to a second named maintainer outside research archives.
- [x] Web app tokens use orange primary on white.
- [x] `pnpm check` green.

## Plan

Single small PR.

## Log

- 2026-10-23 — created and done.

## Links

- Docs: `docs/14-open-decisions.md`, `docs/15-team-workflow.md`
