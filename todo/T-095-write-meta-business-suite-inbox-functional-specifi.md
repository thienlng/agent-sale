---
id: T-095
title: Write Meta Business Suite inbox functional specification
status: in-progress
type: docs
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-27
updated: 2026-10-27
branch: docs/T-095-meta-inbox-spec
pr:
parent:
---

## Context

The user supplied two Meta Business Suite Inbox screenshots and an already-open Chrome window in profile Tùng, and requested a comprehensive BA-style functional specification for later implementation by Claude. Meta replaces Pancake as the reference for the next inbox design discussion. This increment is research/documentation only.

## Goal

Deliver a clear, testable business specification of the Meta-style inbox, with an evidence inventory and explicit Rapiz business/shop/bot adaptations.

## Scope

- Inspect the authorized existing Chrome window, visible controls and safe menus.
- Document the three-region workspace, channel tabs, search/filters, lifecycle, assignment, bulk actions, messaging, customer context, automation/settings and adjacent entries.
- Separate observed controls, proposed Rapiz rules, existing capabilities and conditional/unverified functionality.
- Provide a Vietnamese business artifact under the Rule 01 exception and an English implementation handoff.
- Preserve the approved business-scoped navigation and working Rapiz inbox capabilities.

## Out of scope

- Application implementation, tenant/schema changes, new provider integrations or redesign of unrelated screens/sidebar.
- Deliberate live customer mutations, outbound messaging, calls, ad publishing, automation activation or settings saves.
- Claiming complete API parity from Meta's own first-party UI.

## Acceptance criteria

- [x] The observed workspace and safe menus are recorded with evidence and research limitations.
- [x] Requirements include roles, states, workflows, failure behavior, permissions and acceptance scenarios.
- [x] Rapiz adaptations and current limitations are distinguished from observed Meta behavior.
- [x] Unverified destinations/provider capabilities have explicit follow-up decisions rather than invented behavior.
- [x] Business specification and English handoff are discoverable from the docs index and related task.
- [x] Independent QA feedback is addressed and verification results recorded.
- [x] Formatting, local links and repository gate are checked; failures, if any, are reported honestly.

## Plan

1. Inspect the authorized existing Chrome profile without sending messages, opening unread threads, changing assignment/tags/status, publishing or saving settings.
2. Inventory visible UI and safe menus; use dated official sources where accessible, identifying access failures.
3. Write the Vietnamese BA business document and English repository handoff, with stable IDs, rules, acceptance and capability boundaries.
4. Cross-check the current Rapiz inbox and approved hierarchy; leave implementation tasks open and preserve ownership boundaries.
5. Validate formatting/links and obtain independent same-model QA. Do not implement application changes.

## Log

- 2026-10-27 — Created task and isolated docs branch from main 9265c3c. The original workspace's unrelated changes were not modified.
- 2026-10-27 — Inspected the owner's regular Chrome window through desktop tools. The separate Playwright session was not connected to the owner's profile. Temporary screenshots remain outside the repo; customer PII was not copied into the artifacts.
- 2026-10-27 — An accidental immediate-save selection changed a commerce marker to scheduled appointment. Immediately cleared it back to the original empty value and visually confirmed restoration. Meta retained an activity entry. Informed the owner in chat; no attempt to conceal or delete activity. No messages/calls/ads/automations/settings changes were otherwise performed.
- 2026-10-27 — Wrote business requirements and English handoff. Rule 01 explicitly permits Vietnamese business material under docs/business; technical metadata remains English. Official Help Center/API retrieval failed, so exact provider limits are left for verification rather than asserted.
- 2026-10-27 — Requested independent same-model BA/QA document review. No application implementation or live provider send test was requested from QA.

- 2026-10-27 — Independent same-model QA requested changes on lifecycle/send suppression, note scope, count semantics and ID collisions. All four were corrected. Re-review approved the BA draft for product-owner review with no blocking findings in that scope; conditional capabilities remain discovery gates. Formatting and local links passed; repository gate completed successfully.

- 2026-10-27 — pnpm check passed (lint, architecture, typecheck, tests and build; cached tasks reused where applicable). Existing max-lines warning in conversation.facade.impl.ts remains unchanged. Final artifact-local links resolve; git diff --check passed. Inventory has 108 namespaced requirement IDs and 20 acceptance scenarios. Deliverables remain a product-owner review draft on the docs branch; no application implementation, commit, push or merge is claimed.

## Links

- [Business specification](../docs/business/rapiz-inbox-meta-ba.vi.md)
- [English implementation handoff](../docs/handoffs/2026-10-27-meta-inbox-spec.md)
- [Original refinement task](T-086-refine-the-sales-inbox-around-the-agreed-pancake-w.md)
- [Current Meta inbox](../docs/meta-inbox.md)
- [Sales inbox workspace](../docs/18-sales-inbox-workspace.md)

- [Independent QA record](../docs/handoffs/2026-10-27-meta-inbox-spec-qa.md)

- 2026-10-27 — (@agent:claude) The owner asked to carry these spec files unchanged into branch `feat/T-096-meta-inbox-core` so the implementation PR ships with its requirements. Committed there as a separate T-095 commit.
