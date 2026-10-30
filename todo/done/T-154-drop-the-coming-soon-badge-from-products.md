---
id: T-154
title: Drop the coming-soon badge from the Products menu entry
status: done
type: bug
priority: P2
owner: '@agent:claude'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: main
pr: main
parent:
---

## Context

Owner report (2026-10-29, sidebar screenshot): "Sản phẩm" shows "Sắp có" although the products page is built and uses the products API (T-112). The top-level `PRODUCTS` nav item was added without `ready: true`, so `NavItems` treated it as not built.

## Goal

Built pages never carry the coming-soon badge.

## Acceptance criteria

- [x] The Products entry has no "Sắp có" badge; a sidebar test fails without the fix and passes with it.
- [x] Web typecheck and eslint pass.

## Log

- 2026-10-29 — Done on main.
