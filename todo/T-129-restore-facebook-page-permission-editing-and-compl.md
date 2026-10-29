---
id: T-129
title: Restore Facebook Page permission editing and complete discovery choices
status: cancelled
type: spike
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: fix/T-126-web-acceptance
pr:
parent: T-126
---

## Context

Owner initially reported only TinyMind appeared during Facebook connection. The owner then opened Facebook Edit settings and confirmed both owned Pages are available, with TinyMind alone previously selected.

## Goal

Determine whether discovery drops a granted Page.

## Scope

Read-only audit of authorization, exchange, discovery and selection.

## Out of scope

Revoking permissions, automatic grant expansion and changes to live connected Pages.

## Acceptance criteria

- [x] Identify whether the reported missing choice is reproducible.

## Plan

Inspect provider permission UI and the complete discovery pipeline before changing OAuth parameters.

## Log

- 2026-10-29 — Owner supplied the full two-Page permission picker and withdrew the bug report. No OAuth source change or live grant change performed. Cancelled as a mistaken report; pipeline completeness observations are not asserted as the cause of this incident.

## Links

- Parent T-126
