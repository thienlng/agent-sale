---
id: T-147
title: Execute web acceptance and resolve verified regressions
status: blocked
type: bug
priority: P0
owner: '@agent:codex'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: batch-b/codex-acceptance
pr:
parent: T-094
---

## Context

The owner approved execution of the 116-case web acceptance pack and authorized delegated fixes of reproduced bugs while away. The current live browser/runtime uses b0f1be6; origin/main gained account-foundation 0859328 during planning. Preserve the operating live service and keep tested build identities explicit; do not blindly migrate shared data.

## Goal

Execute available live and isolated cases, fix reproduced regressions, independently retest, and produce an honest per-case release report.

## Scope

- Live owner-to-TinyMind test conversation only, reversible own-thread controls and approved existing AI message allowance.
- Isolated browser/API/statistics/permission/mobile acceptance with safe synthetic fixtures.
- Delegated regression fixes, tests, evidence, final pnpm check and QA review.
- Reconcile acceptance-document task ID collision: the local acceptance documentation task (first T-124, then T-125 on the Codex branch) is T-146 on main; T-124 remains the cofounder account integration.

## Out of scope

- Unapproved public comment/moderation, customer messaging outside the owner test thread, purchases, real orders, shipping, password/credential changes or shared database destructive operations.
- Inventing undecided metrics or implementing absent cofounder business models.

## Acceptance criteria

- [ ] Each planned case has evidence-backed PASS/FAIL/BLOCKED/NOT_IMPLEMENTED/DECISION_REQUIRED or an explicit unexecuted reason; no smoke-test count substitutes for deep acceptance.
- [ ] Every reproduced bug has a failing regression, tracked fix and independent retest.
- [ ] Final build passes pnpm check and relevant browser/API checks.
- [ ] Live own-thread state is restored; unavoidable message/read history effects disclosed.
- [ ] Report includes exact baseline SHAs, test lanes, remaining integration dependencies and no unsupported perfection claim.

## Plan

1. Freeze running live baseline, record own-thread initial state, execute approved provider checks.
2. Delegate deterministic statistics/API acceptance and known responsive regression T-122 to separate agents.
3. Execute broad UI/role/fault suites, reproduce uncovered failures, delegate concrete fixes.
4. Reconcile the ledger from actual assertions, not inferred coverage; run fixed regressions and independent QA.
5. Publish local reviewable evidence and commit coherent fixes; do not claim a newer untested main deployment.

## Log

- 2026-10-29 — Started at owner request; application baseline b0f1be6 plus documentation 02a69a9. All existing live test side-effect boundaries retained.

- 2026-10-29 — Confirmed regression evidence: responsive 125/125 (serial); remaining web production-browser/mocked-API 52/52; site production-browser 8/8; real-backend CRM/team 10/10 and new deep acceptance 4/4; disposable PostgreSQL statistics 11 golden + 18 existing; proxy protocol 6/6. These 234 assertions are supporting evidence, not 234 full acceptance cases or a complete 116-case verdict.
- 2026-10-29 — Live own-thread greeting reached Messenger and Rapiz once; permanent human takeover suppressed AI, staff multiline/emoji sent once and draft survived reload. Explicit bot resume produced a fresh bot response at 00:57:23Z. Original operational bot mode restored; test message/read history remains.
- 2026-10-29 — Live source/UI snapshot at approximately 00:50Z reconciled immutable received events 137 and successful completed sends 29; CRM contact metrics zero with no CRM contacts, comments explicitly unavailable. Legacy received events omit firstMessage 132 times, so zero new-conversation facts cannot certify historical first-conversation completeness. Independent agent confirmed documented legacy fallback; no analytics definition silently changed.
- 2026-10-29 — Detected literal escaped newline in a generated live bot reply while human multiline renders correctly. Delegated tracked T-135 diagnosis/regression/fix; historical sent content stays unchanged.
- 2026-10-29 — Initial final check stopped at formatting of expanded statistics fixture; formatted that new test and restarted the full gate. Completion remains pending.
- 2026-10-29 — Ported onto main from the Codex branch (originally T-126, renumbered because main already used that id range). Reproduced fixes landed on main under new ids: T-122 (kept), T-127 -> T-134 (dev tunnel proxy), T-128 -> T-135 (escaped line breaks), T-131 -> T-136 (Facebook full name). Local T-129 (cancelled, mistaken report) and T-130 (business creation design, superseded by T-144) are not carried. Of 116 cases, 111 remain NOT_RUN and wait for the cofounder's lane A/B integration (owner decision), so the task is blocked on that integration; the statistics acceptance spec and the opt-in live spec are ported with it.

## Links

- docs/qa/web-acceptance/README.md
- T-146 acceptance specification; T-122 responsive harness regression; T-094 integration milestone
