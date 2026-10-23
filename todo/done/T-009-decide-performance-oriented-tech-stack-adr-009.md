---
id: T-009
title: Decide performance-oriented tech stack (ADR-009)
status: done
type: docs
priority: P0
owner: @agent:claude
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch: docs/T-009-tech-stack
pr:
parent:
---

## Context

Owner requirements stated on 2026-10-23: the product must be fast, smooth and modern in every interaction (frontend and backend), and the architecture must scale horizontally to ~1,000 tenants, each with its own business logic, assets and industry (hotels, e-commerce, education centers, mechanical/solar companies, …). The earlier docs chose Next.js for the dashboard without weighing perceived speed.

## Goal

A decided, documented stack and binding performance/scale budgets that every implementation task follows, plus a model for per-industry and per-tenant extensibility.

## Scope

- `docs/adr/ADR-009-tech-stack-for-speed-and-scale.md` (supersedes the Next.js dashboard choice).
- `docs/16-performance-and-scale.md` (budgets, mandatory patterns, scale plan).
- `docs/17-multi-tenancy-and-verticals.md` (industry packs, per-tenant assets/logic, horizontal scaling model), informed by Preny's industry pages.
- Update `AGENTS.md` §5, `docs/02`, `docs/03`, `docs/04`, `docs/10`, `docs/11`, `docs/README.md`, `README.md`, task T-005.

## Out of scope

- Implementing anything; re-estimating the roadmap (done when T-002 is answered).

## Acceptance criteria

- [x] ADR-009 lists the chosen stack per layer with reasons and rejected alternatives.
- [x] Frontend and backend budgets are numeric and measurable in CI.
- [x] Scale plan gives sizing per component at beta and at 1,000 tenants, with the scaling mechanism.
- [x] Vertical/tenant extensibility model documented with Preny evidence and our design.
- [x] No remaining "Next.js dashboard" references in docs, tasks or `AGENTS.md`.

## Plan

1. Write ADR-009 and docs/16.
2. Research Preny's industry pages (`preny-research/06-khao-sat-tung-page`, `07-so-do/08-cay-noi-dung-nganh.md`) → docs/17.
3. Sweep docs for stale stack references; rewrite T-005.
4. PR for human review (protected files: ADR, AGENTS.md → 2 approvals when the second maintainer exists).

## Log

- 2026-10-23 — created; ADR-009, docs/16 written; stack references updated.

## Links

- Docs: `docs/adr/ADR-009-tech-stack-for-speed-and-scale.md`, `docs/16-performance-and-scale.md`, `docs/17-multi-tenancy-and-verticals.md`
- Related: T-005 (rewritten), T-003, T-004
