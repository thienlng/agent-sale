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

- [ ] Product/brand name and domain chosen (not derived from Preny).
- [ ] Hosting region and cloud provider chosen; ADR-006 accepted.
- [ ] Team size confirmed; roadmap in `docs/12-roadmap-and-plan.md` re-estimated.
- [ ] MVP channel priority confirmed (default: Facebook Messenger + Zalo OA + website widget).
- [ ] Meta Business Verification and Zalo developer app registration started (owner named).

## Plan

Human-only. Record answers directly in `docs/14-open-decisions.md`, then unblock T-003+ by moving them in `TODO.md`.

## Log

- 2026-10-23 — created; blocked on human decision.

## Links

- Docs: `docs/14-open-decisions.md`, `docs/adr/ADR-006-hosting-region.md`
