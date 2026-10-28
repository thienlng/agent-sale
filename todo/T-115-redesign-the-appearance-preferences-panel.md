---
id: T-115
title: Redesign the appearance preferences panel
status: next            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2               # P0 | P1 | P2 | P3
owner: "@agent:claude"     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-27
updated: 2026-10-29
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

## Proposal (awaiting Tùng's approval — no code yet)

### Audit of the current panel (`layout-controls.tsx`)

1. Seven controls of equal weight stacked in a 320 px popover; the two that matter most to an SME owner (light/dark, colour) look the same as rarely used layout switches.
2. Layout options are text-only and abstract ("Liền / Lồng / Nổi", "Còn biểu tượng / Ẩn hẳn"): you have to click each one to learn what it does.
3. Light/dark is duplicated: a header button plus a row in the panel.
4. The popover covers the page it is changing, and closes on outside click, so comparing options means reopening it.
5. The entry point is a generic `Settings2` icon next to the theme button; it reads as "settings", not "appearance".
6. "Khôi phục mặc định" is always enabled, even when nothing has changed.

### Proposed panel

A right-side sheet (full screen below 640 px) that leaves the page visible and applies each choice live. Two sections, with the rarely used switches folded under "Nâng cao". Same six preferences, same registry and boot script, so there is still no first-paint flash.

```
┌──────────────────────────────────────┐
│ Giao diện                         ✕  │
│ Chỉ áp dụng cho trình duyệt này.     │
├──────────────────────────────────────┤
│ MÀU SẮC                              │
│ Chế độ                               │
│ ┌────────┐ ┌────────┐ ┌────────┐     │
│ │ ☀ Sáng │ │ ☾ Tối  │ │ ▣ Theo │     │
│ │   ✓    │ │        │ │   máy  │     │
│ └────────┘ └────────┘ └────────┘     │
│ Bảng màu                             │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│ │ ███  │ │ ███  │ │ ███  │ │ ███  │  │  ← mini app preview
│ │Rapiz✓│ │ Biển │ │ Rừng │ │Than  │  │    in the preset's
│ └──────┘ └──────┘ └──────┘ └──────┘  │    colours
├──────────────────────────────────────┤
│ BỐ CỤC                               │
│ Thanh bên                            │
│ ┌──────┐ ┌──────┐ ┌──────┐           │
│ │▌ ▭▭▭ │ │▌┌──┐ │ │ ▌ ▭▭ │           │  ← thumbnails:
│ │▌ ▭▭▭ │ │▌└──┘ │ │ ▌ ▭▭ │           │    attached / inset /
│ │ Liền✓│ │ Lồng │ │ Nổi  │           │    floating
│ └──────┘ └──────┘ └──────┘           │
│ Nội dung                             │
│ ┌──────────┐ ┌──────────┐            │
│ │ │ ▭▭▭ │  │ │▭▭▭▭▭▭▭▭▭▭│            │
│ │Căn giữa ✓│ │Toàn màn  │            │
│ └──────────┘ └──────────┘            │
│ ▸ Nâng cao                           │  ← collapsed by default
│   Khi thu gọn thanh bên: [Còn biểu tượng | Ẩn hẳn]
│   Thanh trên cùng:       [Cố định | Cuộn theo]
├──────────────────────────────────────┤
│ [↺ Khôi phục mặc định]  (disabled if │
│                          unchanged)  │
└──────────────────────────────────────┘
```

- **Entry point:** the header keeps one quick light/dark button; the panel trigger becomes a `Palette` icon labelled "Giao diện", also listed in the account menu.
- **Wording:** "Tuỳ chỉnh giao diện" → "Giao diện"; section titles "Màu sắc" / "Bố cục"; options keep their current names, explained by the thumbnails.
- **Accessibility:** every card group is a radio group (arrow keys, visible focus); the sheet traps focus and closes on Esc.
- **Not included:** new presets or brand colours, server-side sync (out of scope).

Open questions for Tùng: (a) keep the header light/dark button? (b) are "Thanh trên cùng" and "Khi thu gọn" worth keeping at all, or should they be removed (they would then stay at their defaults)?

## Plan

Written by the implementer before coding (see `start-task` skill).

1. …

## Log

- 2026-10-28 — Audit and mockup proposal written above; waiting for Tùng's approval before any code.

- 2026-10-27 — created from the review ("Tuỳ chỉnh giao diện cần làm lại"). Requirements unknown: mockup first.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
