---
id: T-002
title: Finalize open decisions (brand, hosting region, team, priorities)
status: blocked
type: chore
priority: P0
owner: @thienlng
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch:
pr:
parent:
---

## Context

`docs/14-open-decisions.md` lists decisions only the humans can make. Several downstream tasks (branding in apps, hosting/infra, Meta/Zalo app registration) depend on them.

## Goal

Every row in `docs/14-open-decisions.md` has a recorded answer; ADR-006 (hosting region) is accepted.

## Scope

- Answer sections A (business), B (technical), C (legal) in `docs/14-open-decisions.md`.
- Update affected ADRs (`docs/adr/ADR-006-hosting-region.md` at minimum) to `Accepted`.

## Out of scope

- Implementing any of the decisions.

## Acceptance criteria

- [x] Product/brand name chosen: **Rapiz** (white/orange identity; was Razpi until 2026-10-24). Domain still open.
- [ ] Data-center location chosen (hosting model decided: self-hosted only — ADR-006).
- [x] Team: one human maintainer (`thienlng`) + coding agents. Roadmap re-estimate pending.
- [ ] MVP channel priority confirmed (default: Facebook Messenger + Zalo OA + website widget).
- [ ] Meta Business Verification and Zalo developer app registration started (owner named).

## Plan

Human-only. Record answers directly in `docs/14-open-decisions.md`, then unblock T-003+ by moving them in `TODO.md`.

## Log

- 2026-10-23 — created; blocked on human decision.
- 2026-10-23 — decided: brand Razpi (white/orange), single maintainer, self-hosted only. Open: domain, data-center location, MVP channels, Meta/Zalo registration.
- 2026-10-24 — brand renamed Razpi → Rapiz by the owner (PR #40).

## Links

- Docs: `docs/14-open-decisions.md`, `docs/adr/ADR-006-hosting-region.md`
