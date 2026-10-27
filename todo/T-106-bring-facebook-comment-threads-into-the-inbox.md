---
id: T-106
title: Bring Facebook comment threads into the inbox
status: next
type: feature
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-27
updated: 2026-10-27
branch: 
pr:
parent:
---

## Context

On 2026-10-27 the product owner approved the brainstormed parallel split: external Claude implements Facebook comments inside Inbox; Codex writes its spec and implements DM draft continuity and personal Enter settings. This continues the T-095 specification and T-096 core.

## Goal

Handle received Facebook comments directly in Inbox with correct context and safe public/private/moderation actions.

## Scope

Implement the approved handoff: Facebook-only comments workspace, Page/post selection, server pagination over stored comments, detail context and existing reply/hide/unhide actions. Preserve T-069 safety and follow T-107 file ownership.

## Out of scope

Generic automation, background reminders, direct upload/private storage design, Instagram comments, deletion/block/report, shop/tenant model changes, global sidebar or unrelated screens. No live customer mutations.

## Acceptance criteria

- [ ] C01–C13 of the handoff are verified with synthetic data.
- [ ] Existing fanpage settings and DM inbox remain compatible; no cross-feature imports.
- [ ] New read/action contracts have validation, permission and cross-tenant tests.
- [ ] Targeted browser checks, pnpm check and fresh-context QA pass; live limitations are stated.

## Plan

External Claude fills its detailed implementation plan after claiming the task. Product scope and acceptance are specified in the handoff.

## Log

- 2026-10-27 — Created from the approved parallel block. Codex authored the T-106 handoff before application implementation. T-106 remains next for external Claude; only T-107 is active locally.

## Links

- [T-106 functional/implementation handoff](../docs/handoffs/T-106-facebook-comments-inbox.md)
- [Meta-style BA specification](../docs/business/rapiz-inbox-meta-ba.vi.md)
- [Current sales workspace](../docs/18-sales-inbox-workspace.md)
- [Current comment behavior](../docs/integrations/facebook-comments.md)
