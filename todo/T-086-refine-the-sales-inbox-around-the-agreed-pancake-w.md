---
id: T-086
title: Refine the sales inbox around the agreed Pancake workflow
status: backlog
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-27
branch:
pr:
parent:
---

## Context

The integration app already has the T-068 sales inbox layout. The screenshot and review call for further workflow and visual refinement rather than an entirely new messaging system.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Refine the sales inbox around the agreed Pancake workflow.

## Scope

- Prepare and review an annotated layout for channel/shop navigation, conversation list, thread/composer and customer sidebar using the supplied screenshot as the initial reference.
- Improve density, unread separator, bot/human attribution, assignment/resolution controls, quick replies and product attachments using existing capabilities.
- Preserve drafts, scroll position, selected thread and delivery/takeover behavior; provide responsive and keyboard-friendly panels.

## Out of scope

- New provider integrations, full Pancake clone, tag API fix T-090, shop filter logic T-087.

## Acceptance criteria

- [ ] Reviewers sign off the target workflow and screenshots before broad component changes.
- [ ] Receive, read, send, retry, assign, resolve and take over a conversation without losing draft or selection.
- [ ] Responsive checks and representative live-backend inbox flows pass; no claim of full Pancake feature parity.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = cofounder; B = user with Codex (updated user assignment). These are planning labels, not committed GitHub assignments.
- Base estimate: 4 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

To be filled by the implementer before coding. Scope and acceptance above are the planning contract.

## Log

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)

- 2026-10-26 — Lane B triage: The running T-068 inbox already supplies the reviewed multi-pane structure. This pass fixes concrete tag failures and keeps its working layout; a complete Pancake-style visual/workflow redesign is larger than the requested simple independent fixes and remains open for an agreed target. No full product parity is claimed.

- 2026-10-27 — Lane B owner set to @agent:claude by the user.

## Updated reference — 2026-10-27

The product owner now requests Meta Business Suite Inbox as the functional reference. T-095 documents the broader business inventory without starting this implementation task or changing its owner. The original four-person-day estimate applies only to the earlier limited refinement; it is not an estimate for full Meta parity. Before implementation, re-scope this task and link additional implementation tasks for conditional capabilities and existing lane boundaries.

- [Meta-style Inbox BA specification](../docs/business/rapiz-inbox-meta-ba.vi.md)
- [Research and implementation handoff](../docs/handoffs/2026-10-27-meta-inbox-spec.md)
