---
id: T-093
title: Scope business settings and bot defaults to the selected industry
status: blocked
type: feature
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-26
updated: 2026-10-28
branch: feat/tung-dev
pr: 77
parent:
---

## Context

Each business has one industry, and its settings should reflect that industry. A selected business must not silently inherit another business industry or account billing settings.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Scope business settings and bot defaults to the selected industry.

## Scope

- Bind existing industry-specific settings/navigation/defaults to the selected business and separate them from account-level packages.
- Prevent contradictory bot industry choices or explicitly migrate them under the approved model; document industry-change policy.
- Support currently implemented vertical settings with capability-aware empty states for missing functionality.

## Out of scope

- Implementing hotel, education or other vertical operational engines not already present.

## Acceptance criteria

- [x] Switching between two industries changes the relevant settings context without modifying the other business.
- [ ] Account billing is visibly separate and a bot cannot silently contradict its business industry.
- [x] Changing industry is either explicitly supported with a safe migration or blocked with a clear explanation.
- [x] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [x] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = cofounder; B = user with Codex (updated user assignment). These are planning labels, not committed GitHub assignments.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078, T-079
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

1. Add failing regressions for a mismatched bot creation request, unsupported stored business industry and correct selected-workspace scoping; retain legacy bot edits.
2. Read the workspace industry through its public facade before bot creation and reject contradictions before seeding/saving. Wire the existing workspace module without a schema/model change.
3. Compose the existing current-workspace query in the bots route and pass context into the bot feature. Show the fixed business industry in the creation dialog, with loading/error/unsupported states, no retail fallback and no extra picker.
4. Show selected business/industry and immutable-industry guidance in business settings. Label legacy mismatched bots without migrating or disabling existing data.
5. Add matching vi/en copy and feature docs, align only affected synthetic bot fixtures, run focused HTTP/UI tests and hand the combined gate to the parent.

Existing industry-changing updates are not supported. The current contract permits no industry mutation. Account billing stays separate in the existing profile copy; T-092's account quota/ownership API remains outside this task. No new endpoint, schema, migration, runtime dependency or account/business/shop model.

## Log

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.
- 2026-10-28 — Claimed under the owner’s request to finish the independent lane B work while they are away. Existing workspace industry and public facade support a real scoped increment without implementing lane A. Plan recorded before source changes.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)

- 2026-10-26 — Lane B triage: Industry-scoped settings and defaults depend on the approved business context and industry-change policy in T-077/T-078/T-079. Existing settings remain intact.

- 2026-10-27 — Lane B owner set to @agent:claude by the user.


## Delivered independent increment (2026-10-28)

- Creation uses the selected workspace's supported industry in UI and server validation. A mismatched request or unknown legacy industry fails before writes or seeding; no retail fallback is used.
- The bots route composes the existing workspace query through props, preserving feature boundaries. Fixed industry means one less choice/click.
- Read-only business settings show the current business name/industry and explain why changing industry is unavailable. The surrounding Settings heading remains neutral because its existing Security tab is account-scoped.
- Existing bots with a historical industry mismatch keep their data and controls, with a visible explanation. Ordinary legacy edits remain available.
- Workspace reads bind the captured workspace ID and cancellation signal; retry cannot cache another business's industry under the earlier key.
- Account billing ownership/allowance is still deferred to T-092/T-091. The combined original billing acceptance criterion is intentionally not marked complete. No account usage was fabricated or workspace allowance relabelled.

### Verification log

- Before implementation: new HTTP policy tests failed 2/3, UI creation regressions failed 3/3, and captured-scope retry failed 1/1.
- After implementation: frontend four files / 15 tests passed (`/tmp/t093-final-all-ui.log`); backend new industry HTTP plus existing HTTP suite passed 31/31 (`/tmp/t093-final-http.log`). Existing generic fixtures now create a bot matching their declared workspace industry; no assertions were removed or weakened.
- Additional real Postgres bot/AI/team regression passed 3 files / 15 tests (`/tmp/t093-integration.log`). Parent owns full `pnpm check`, browser checks and independent QA on the combined branch.
- Details: `docs/handoffs/T-093-business-industry.md`.

- 2026-10-28 — Parent full gate passed with final source: backend 68 files / 1,104 tests; frontend 75 files / 499 tests; initial bundle 232.2 KB gzip under 250 KB. Independent same-model QA approved source, tenant retry fix and real workspace fixture updates. Existing delete/history fixture assertions remain intact. Browser acceptance is recorded in the final lane B closeout.

- 2026-10-28 — Final independent B acceptance is green (full gate, 47 functional and 114 responsive tests). Parent remains open/blocked only for partial: business industry increment delivered; account billing separation awaits T-092/T-091. No missing backend behavior was represented as completed.

- 2026-10-28 — Final remote audit found draft account/bot attribution work in T-077/T-079 and separate portfolio/UX forks. ADR-012 is still Proposed and reverses the original shop/avatar-switch decisions; no blind merge was made. T-087 server filters and T-092 account usage APIs are still absent. This parent waits for an accepted/integrated model, not a claim that no remote work exists. See final remote audit in docs/handoffs/2026-10-28-lane-b-closeout.md.
