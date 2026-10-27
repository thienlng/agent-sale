---
id: T-112
title: Move product management to its own top-level navigation group
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: "@agent:claude"     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-27
updated: 2026-10-27
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Products (`/app/products`) currently sit inside the Orders navigation group (`apps/web/src/components/layout/app-sidebar.tsx`). The review asks for product management at the same level as order management, because the catalog is also what bots sell from (see T-116).

Source: cofounder walkthrough in chat on 2026-10-26 (lane B, see [handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)). Lane B owner: @agent:claude (assigned by the user on 2026-10-27); lane A belongs to the cofounder.

## Goal

Products are a top-level navigation destination next to Orders, without changing product data or URLs.

## Scope

- Move the Products entry out of the Orders group into its own group/section with its own icon and label.
- Keep `/app/products`, `/app/products/new` and `/app/products/$productId` working; active-state highlighting follows the new group.
- Collapsed sidebar, mobile drawer and expanded layouts all show the new entry.

## Out of scope

- Product data model or per-bot selection (T-116); shop catalogs (T-080, lane A).

## Acceptance criteria

- [ ] Products appear as a sibling of Orders in every sidebar layout, and Orders no longer lists Products.
- [ ] Existing product URLs and bookmarks open the same pages; permissions are unchanged.
- [ ] Sidebar tests and the responsive matrix cover the new entry; `pnpm check` green.
- [ ] vi/en labels present; docs/03 screen map updated.

## Plan

Written by the implementer before coding (see `start-task` skill).

1. …

## Log

- 2026-10-27 — created from the review ("tách quản lý sản phẩm ra ngoài bằng cấp với quản lý đơn hàng").

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Screens and routes](../docs/03-screens-and-routes.md)
- Related tasks: T-116, T-080
