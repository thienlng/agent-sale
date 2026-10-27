---
id: T-115
title: Redesign the appearance preferences panel
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2               # P0 | P1 | P2 | P3
owner: "@agent:claude"     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-27
updated: 2026-10-27
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Tùng asked that "Tuỳ chỉnh giao diện" (appearance preferences: theme preset, light/dark, sidebar layout; `components/layout/layout-controls.tsx`, `lib/preferences`) be redone. No concrete target was given. Decision 2026-10-27 (user): lane B proposes a mockup first and Tùng approves it before code.

Source: cofounder walkthrough in chat on 2026-10-26 (lane B, see [handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)). Lane B owner: @agent:claude (assigned by the user on 2026-10-27); lane A belongs to the cofounder.

## Goal

An approved, simpler appearance panel that applies preferences instantly and without layout flash.

## Scope

- Audit the current panel and propose a mockup (grouping, previews, wording, placement) for review.
- After approval, implement it on top of the existing preferences registry and boot script.

## Out of scope

- New themes or brand colours beyond the approved mockup; server-side preference sync.

## Acceptance criteria

- [ ] Mockup approved by Tùng (link or screenshot recorded in the Log) before implementation starts.
- [ ] Every existing preference remains available and persists across reload with no first-paint flash.
- [ ] Keyboard accessible; responsive at 375–1920 px; UI tests; `pnpm check` green.
- [ ] vi/en strings.

## Plan

Written by the implementer before coding (see `start-task` skill).

1. …

## Log

- 2026-10-27 — created from the review ("Tuỳ chỉnh giao diện cần làm lại"). Requirements unknown: mockup first.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
