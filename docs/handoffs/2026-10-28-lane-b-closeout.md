# Lane B delivery and remaining integration prerequisites

Date: 2026-10-28. Branch: `feat/tung-dev`. The owner requested completion of independently implementable lane B work while lane A status is unknown. Source inspection below applies to this branch, not unshared cofounder work.

## Delivered scope

- T-076: initial bundle stays within the unchanged 250 KB gzip budget.
- T-083: bot Pages/channels navigation and global integrations remain separate, with old URLs preserved.
- T-084: bot enable switches on management/training and existing advanced controls.
- T-085: distinct training facts/instructions guidance without moving stored content.
- T-090: required customer-tag attributes are collected before assignment; failures retain accurate state.
- T-095/T-096/T-106/T-107: approved Meta-style Inbox implementation, stored Facebook comments and DM composition continuity. These supersede the earlier T-086 Pancake refinement; this is not a claim of complete Meta feature parity.
- T-110: server-side settings capability and read-only automation settings for other roles.
- T-093 independent increment: selected-business industry behavior using the current workspace context, server validation and immutable tenant retries. Account billing remains part of blocked T-092; the original combined criterion is still open. See [industry implementation](T-093-business-industry.md).

The source audit was performed independently by `/root/audit_remaining_lane_b`, using the same inherited model. It checked current implementations, not just stale task-board labels.

## Real dependencies that remain

| Our task | Working now | Missing lane A prerequisite |
|---|---|---|
| T-081 | Authorized business statistics, portfolio and business switching | Approved selling-unit model and historical attribution for shop/unit totals and breakdowns (T-077/T-078/T-080) |
| T-082 | Shared outer/inner inventory, bot assignment/unassignment, bot/unassigned filters, partial failure retry | Approved selling-unit ownership/eligibility rules and filters (T-077/T-078/T-080) |
| T-087 | Existing provider/channel and sales Inbox filters | Server-authorized shop/bot scope, counts, pagination and original historical attribution (T-078/T-080) |
| T-092 | Existing workspace entitlement/plan checks retain their actual workspace scope | Account billing owner/permissions, one account allowance, billable used/remaining/reset counters and business/shop/bot breakdown (T-079/T-091) |

Evidence: no account/business/shop hierarchy exists in the current DB schema; the conversation query has provider/channel fields but no shop attribution; `/billing/entitlements` is workspace-scoped and provides plan/limits, not account usage counters. Bootstrap memberships identify workspaces and roles; they are not an account-billing ownership contract.

Do not rename channels as shops, sum unrelated workspace plans into an account allowance, infer billing rights from a business membership, or display synthetic usage. No such substitute was implemented.

## Lane A handoff needed to finish integration

1. Supply the approved committed migration/contracts and safe backfill for account, business and selling-unit/channel ownership. The original shop proposal and the newer no-shop proposal must not be combined without an owner decision. Preserve existing conversations, contacts and jobs under their original authorized tenant context.
2. Define which shop a conversation/event belongs to after a channel is reassigned, and whether a bot filter means current assignment or original attribution. Expose that scope through the server query, counts, pagination and realtime events consistently.
3. Expose authorized selling-unit metadata and assignment eligibility under the accepted model. T-082 can then apply the same rules from both inventory entry points; T-081 can reconcile real shop breakdowns.
4. Supply the account quota API: billing owner, plan, allowance, billable consumed/remaining messages, reset boundary and authorized breakdown. Specify expiry/exhaustion behavior without counting provider retries twice.
5. Share the implementation branch/PR. Finish the dependent B UI/API integration and run shared T-094 acceptance against the same revision.

No lane A implementation or migration was guessed while the owner was unavailable.

## Verification and limits

All tests use synthetic data. Existing provider/live-environment limitations from T-106 remain; no real Meta messages or customer mutations were used for acceptance.

- Full `pnpm check` passed: backend 68 files / 1,104 tests, frontend 75 files / 499 tests, initial bundle 232.1 KB gzip under 250 KB. Commands, assertions and timeouts were unchanged. On this busy local machine the gate process was bound to two available CPUs to avoid oversubscribing test workers. An earlier unrelated 500-row training test load timeout passed unchanged in isolation (11/11) and in the complete bounded-resource gate.
- T-110 failing-first regressions: two role cases failed in both frontend and real HTTP tests before the guard fix. Green: frontend 4/4 and HTTP 7/7; owner/admin may save, analyst/sales may read only, foreign scopes return 404 and denied writes preserve state. Fresh same-model reviewer `qa_t110_settings_permissions` approved.
- T-093 focused: frontend 15/15, HTTP 31/31, additional real PostgreSQL bot/AI/team integration 15/15. Seven older bot-delete/history tests now create real matching workspaces; original assertions remain intact.
- Fresh same-model `qa_t093_industry_final` approved industry validation, route composition, explicit workspace retry scope, legacy preservation, tests and fixture adjustments. Source audit and boundary review were independently approved by `audit_remaining_lane_b`.
- Final production-browser acceptance by `qa_t110_settings_permissions`: 47/47 passed across business industry, lane B workflows, fanpage, comments, DM continuity, Inbox sales/layout, statistics and smoke. It covers a completed sidebar business switch followed by bot creation with the expected industry and tenant header. The test explicitly waits for persisted context before reload.
- Mobile visual acceptance at 390px passed. A newly found historical-industry notice layout issue was fixed by giving it its own full-width row, with an explicit width regression. Screenshot: `/tmp/lane-b-business-industry-mobile.png`.
- T-118 preserves every original responsive route/viewport pair and all heading, overflow and runtime-error assertions. The original four monolithic 28-route cases timed out under their shared 30-second budgets; an unchanged 375px diagnostic traversed all routes in 25.4 seconds. No product drawer bug was reproduced. The official replacement retains the configured timeout and has 112 route/viewport cases plus two existing preference/layout cases; final execution results follow below.

No test, route, assertion or performance budget was removed, skipped or lowered. An externally terminated intermediate browser process is retained as interrupted evidence and was rerun to a complete 47-test summary rather than counted as a pass.


### Final independent acceptance

Reviewer `qa_t110_settings_permissions` approved the final frozen production build after execution: **47/47 functional tests and 114/114 responsive tests**, both exit 0, two workers and the unchanged configured timeout. All 112 page/viewport pairs and both preference/layout cases passed. The 390px image was viewed and the full-width legacy industry notice and create dialog were accepted. No browser blocker remains in this independent increment.

The interrupted intermediate browser process and original monolithic timeout results were not counted as passes. Final logs are `/tmp/lane-b-final-browser.log`, `/tmp/lane-b-responsive.log` and `/tmp/lane-b-independent-final-qa.md`.

### Delivery and review

The owner-requested destination remains `feat/tung-dev`. Standard PR checks require a task-number branch, so a review alias `feat/T-117-lane-b-closeout` may point to the exact same final commit for automated CI and maintainer review without editing protected workflows or changing main. Remaining parent tasks are explicitly partial/blocked: T-081, T-082, T-087, T-092 and T-093's original account-billing criterion. Their independent delivered portions remain usable.


## Final remote audit: newer cofounder work

A final `git fetch` found work that was not on the verified canonical branch. Fresh same-model read-only reviewer `audit_new_remote_foundations` inspected it; none was merged into this delivery:

| Branch/head inspected | Actual scope | Integration gate |
|---|---|---|
| `feat/T-077-account-foundation` / `f6da7ed` | Account membership/ownership, migrations/backfill, bot attribution and analytics bot filtering | ADR-012 is Proposed and owner approval remains unchecked |
| `feat/T-079-business-switching` / `a0c0b29` | Builds on foundation: account-grouped business context/creation, lost-business handling and bot product selection | Depends on the proposed foundation and overlaps session/bot behavior |
| `feat/T-108-account-portfolio-layer` / `32deee4` | Separate fork: account portfolio/navigation and business creation | PR #76 has no reviews and does not contain the foundation APIs |
| `feat/T-112-lane-b-ux-block` / `cb8f27c` | Separate fork: product/bot navigation, bot statistics and appearance proposal | Not completion of the original T-087/T-092/T-093; appearance remains a mockup |

The newer [ADR-012 proposal](https://github.com/thienlng/agent-sale/blob/feat/T-077-account-foundation/docs/adr/ADR-012-accounts-own-businesses-bot-is-selling-unit.md) changes the original model: a bot is the selling unit, there is no separate shop entity, catalog ownership is at business level, and billing counts delivered AI replies. It also restores business switching in the avatar menu, contrary to the last sidebar-only direction in this session. These are review decisions, not changes this B delivery silently accepts.

Some foundation code is real, but remaining contracts are not all available: ConversationListQuery still lacks bot/shop filtering, and the account controller has no plan/usage API. Analytics `botIds` attribution exists only on the draft foundation. The UX branch currently filters bot statistics through assigned `pageIds`; combining it with historical bot attribution requires a deliberate update rather than moving history when Pages are reassigned.

Before integrating those branches: obtain the ownership/ADR decision, choose one account/business navigation implementation, preserve this delivery's private-cache/session cleanup and industry validation, reconcile task IDs (T-119), then validate migrations and the dependent B scope against one revision. No missing-data claim in this report is a claim that the cofounder has done no work elsewhere.

Only the unpublished closeout/responsive tasks were renamed from local T-112/T-113 to T-117/T-118 because the fetched branches already allocate those IDs. Earlier local commit footers remain historical aliases; published source history and the other branches were not rewritten.
