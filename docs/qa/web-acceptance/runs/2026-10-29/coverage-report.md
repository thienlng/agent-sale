# T-147 run coverage reconciliation — 2026-10-29

> Note on ids: file names and paths in this run's evidence keep the original local ids (`t126` = T-147, `t127` = T-134, `t131` = T-136). The live spec now lives at `apps/web/e2e-live/web-acceptance.live.spec.ts`; [source-fingerprints.json](source-fingerprints.json) records the old path as captured.

This report reconciles actual evidence against the **116 owner-reviewed acceptance cases**. It is not a claim that the entire web app or a newer `main` deployment is accepted. The [run ledger](execution-ledger.csv) has exactly one reconciliation row per case; the [baseline ledger](../../execution-ledger.csv) remains unchanged.

## Baseline and verdict rules

- Product baseline exercised by the running app: `b0f1be6`. Documentation commit: `02a69a9`; execution tracking HEAD at reconciliation: `1ddcacc`, branch `fix/T-147-web-acceptance`.
- Tests and the T-122/T-134 development-proxy fix were working-tree changes during these runs. [File fingerprints](source-fingerprints.json) identify the present test/proxy files and built entry files; this is not a final immutable release commit. Root owns final commit and gate reconciliation.
- Newly merged account foundation `origin/main` at `0859328` was not deployed into this operating live baseline and is **not certified** here. No shared migration was performed to disguise that boundary.
- Separate lanes: actual owner-to-TinyMind provider delivery; production-built React with mocked APIs; static Astro; real local backend/browser with newly created synthetic businesses; disposable real-Postgres HTTP/projection integration; isolated local proxy protocol stubs.
- A full `PASS` requires every assertion/variant in the written case and its stated lane. `NOT_RUN` with `coverage=PARTIAL` means there is useful executed evidence, but the complete case is still unexecuted; it does **not** mean an observed assertion failed. `coverage=NONE` means no case-specific assertion was executed. Broader test titles never substitute for missing assertions.
- No raw customer text, names, IDs, screenshots, tokens, cookies, MFA secrets or HAR payloads are included. Live screenshots/source records remain private outside git. Counts and case-level outcomes below are sanitized operational evidence.

## Case-level disposition

| Verdict | Cases | Meaning |
| --- | ---: | --- |
| PASS | 2 | AUTH-001 successful isolated login/deep-link/reload; BOT-001 observed live greeting continuity/delivery/reload |
| NOT_RUN | 111 | 90 partially evidenced cases and 21 cases without case-specific execution; exact missing assertions recorded per row |
| BLOCKED | 1 | ANA-030 complete historical live numerical certification cannot be established for new-conversation history because legacy source attribution is incomplete |
| NOT_IMPLEMENTED | 1 | ANA-013 comment analytics has no source; its unavailable UI/API behavior is observed, not a successful comment count |
| DECISION_REQUIRED | 1 | ANA-031 absent/new indicators and unresolved business formulas require explicit release scope and subsequent implementation acceptance |
| Total | 116 | No smoke-test count is promoted to complete acceptance |

The coverage column totals are FULL2, PARTIAL91 (including the blocked historical case), NONE21 and DEFERRED2. The low full-case count is intentional: the pack combines extensive UI, domain, source, failure, permission and sometimes provider variants in one case. **There are many passing assertions, but most broad cases have not yet been completely executed.**

## Confirmed automated evidence inventory

These are **240 passing test invocations**, not240 acceptance cases. The separate live exchange adds observed provider evidence; it is not folded into the automated count. Earlier failed/overloaded/restart-interrupted attempts are retained as diagnostics and never counted as successful runs.

| Evidence ID | Lane | Confirmed result | Evidence location and limits |
| --- | --- | --- | --- |
| E-RESP | Production web + mocked API, serial | 125/125 | `/tmp/t126-responsive-final.log`: 28 routes ×4widths=112, same12 layout combinations, one preference-persistence case; no runtime page errors/overflow assertions failed. Does not cover200%zoom, every independent theme/preset/navbar combination or all focus interactions. |
| E-WEB | Production web + mocked API | 52/52 | Root-attested terminal session45611; `/tmp/t126-web-final-results` holds artifacts. Source suites: smoke, statistics-home, business-industry, inbox-layout, inbox-sales, inbox-comments, inbox-compose-continuity, lane-b-workflows, fanpage. No redirected text log was produced for that invocation; no log path is invented here. |
| E-SITE | Static production Astro/browser | 8/8 | Root-attested terminal session93063,25.9s. Earlier same-scope8/8 retained in `/tmp/t126-site-e2e.log` is supplementary, not counted again. Source `apps/site/e2e/{landing,fonts}.spec.ts`. |
| E-SUPPORT | Real local backend + synthetic browser businesses | 10/10 | `/tmp/t126-support-final.log`: CRM5 and team5, serial. Actual source mutations, ownership/seat/invitation-role cases; no real customer invitation or provider delivery. |
| E-DEEP | Real local backend + synthetic browser businesses | 4/4 | `/tmp/t126-deep-final.log`: successful/invalid login recovery, deep-link/logout, two-business contact scope, source entitlements/menu/mobile/focus, same-name contacts/idempotency/invalid/stale writes. |
| E-STABLE | Real local backend + synthetic browser businesses | 6/6 | `/tmp/t126-support-stable.log`: commerce3, profile1, security1, statistics1. Order/stock/item-price/payment-record/source-policy behavior; synthetic profile/logo/audit and MFA flow; CRM-backed statistics/drilldown/source filter. No real payment gateway/customer account is certified. |
| E-GOLD | Disposable real PostgreSQL/Nest HTTP, independent historical outbox fixture | 11/11 | `/tmp/t126-statistics-golden-expanded.log`; [statistics detail](statistics-evidence.md). Exact G-A/G-B arithmetic, origins/asOf/ownership/pages/drilldowns/51equal-timestamp rows/new arrivals/rebuild/invalid queries. Fixture writes source events rather than facts; this does not prove every domain command emits them. |
| E-STATS | Disposable real PostgreSQL integration supplement | 18/18 | `/tmp/t126-statistics-existing.log`: statistics7 and analytics11; real CRM commands, source projection, replay, ownership scope, boundaries, gaps, rebuild and dead letters. |
| E-PROXY | Isolated temporary local upstreams, no live provider | 6/6 | `/tmp/t127-green.log`; `node --test scripts/dev-tunnel-proxy.test.mjs`. Root/site/API/OAuth/webhook HTTP and Vite/non-Vite upgrade dispatch. |

All20 real-backend browser tests passed across E-SUPPORT10 + E-DEEP4 + E-STABLE6. The earlier six-test attempt containing transient signup/refresh502s during an API watcher restart and an overloaded statistics skeleton timeout is not accepted as a pass. The later controlled six-test run is the accepted evidence.

The full disposable-backend integration run and final `pnpm check` were still root-owned work at this reconciliation point; future successes are not counted in the table. A focused T-135 AI test count is also not included as app acceptance because its normalization change was still under independent review.

## Live provider observations

Evidence IDs E-LIVE and E-HMR are root-observed/attested; raw supporting material stays private.

- **E-LIVE:** one approved own-thread greeting appeared once in Rapiz, the bot reply appeared once in Messenger, and reload/reopen preserved the observed conversation. This supplies full BOT-001 evidence for that observed scenario.
- Permanent human handling stopped the bot during the observed own-thread probe. A staff multiline+emoji reply reached Messenger once; an unsent draft survived a Rapiz reload. Explicit resume returned the thread to bot handling and a new bot answer was observed at `2026-10-29T00:57:23Z`.
- These observations do not prove temporary expiry, all live eligibility/fault/retry cases, product grounding or a timed multi-input burst. BOT-006 remains partial until its no-timer and case-specific persisted human-state evidence is archived. BOT-004 remains partial because an apparent literal escaped newline in a bot answer requires its own reproduction/fix/retest and does not establish burst/context correctness.
- **E-HMR:** after the root-coordinated proxy restart, a separate public `/login` browser observed one tunnel-host WebSocket receiving one frame, no socket errors and no page errors. The child agent did not restart shared services. This verifies the specific repaired HMR path, not every page's console/network state.

### Absolute statistics snapshot and historical gap

At the root's `00:50Z` observation snapshot, the live UI and authorized source-event enumeration agreed on **137 incoming messages** and **29 successfully sent messages**. CRM source had **zero contacts**, consistent with zero customer/phone/tag/status values; comments were explicitly unavailable. These are snapshot values and must not be presented as the final totals after later QA sends.

The UI showed **zero recorded new conversations**, while132 legacy incoming source records lacked `firstMessage` attribution. That is an identified historical evidence/data-lineage gap. It is **not a confirmed current numerical-code bug**, and no count or backfill was fabricated. A recoverable original conversation-opening source or accepted legacy policy is needed before certifying absolute business-history openings. This is why ANA-030 is BLOCKED rather than PASS or an invented FAIL.

## Fixed defects and pending observations

| Item | Before | Fix / accepted retest | Remaining boundary |
| --- | --- | --- | --- |
| T-122 | Repeated original monolithic12-combination test failed3/3 at default30s while toggling after previous navigations; isolated single run had passed16s | Same combinations split into independently timed fresh-context tests; all preference/state/overflow assertions retained/strengthened; final responsive125/125 | Full independent layout/theme/preset/navbar Cartesian product and zoom/keyboard acceptance still incomplete |
| T-134 | Vite root `vite-hmr` upgrade hit marketing upstream; two protocol regressions failed site-versus-web assertions; live client showed HMR errors | Recognize HMR subprotocol while keeping root HTTP/site routes; protocol6/6 and public received-frame/no-error recheck pass | Full console/network matrix across all screens remains incomplete |
| T-135 observation | One live bot answer appeared to retain a literal escaped newline; staff multiline was correct | Root coordinates source fix and regression work; not certified by this report | Initial normalizer review identified a quoted-code false positive; arbitrary code/path literals must not be blindly unescaped. Root must resolve review and rerun before release |

Fixing a reproduced defect does not automatically pass its entire broader acceptance case. No unresolved ambiguous provider send was retried by this reporting/review agent.

## Main remaining work by feature

- **Inbox lists/control:** independent source-set search/count/filter/ANY-ALL-EXCLUDE/phone/assignee matrices; bulk selection and every partial-failure action; live status/tag/follow-up source persistence and restoration.
- **Composer:** empty thumbs-up; attachment real receipt; length/IME/slash/quick-reply edge matrix; failure/pending/unknown/provider-idempotency and delayed-completion variants; storage lifetime/capacity/denial and full user/business/channel scope.
- **Bot:** approved-product factual claim oracle, unknown-fact fallback, real burst/context/formatting, temporary takeover timer and full inactive/unassigned/edit-role variants.
- **Comments:** >200posts/>50comments fixture pagination; source freshness/deleted/media variants; pending/unknown/new-attempt reconciliation; complete permission matrix; live public reply/moderation requires a dedicated approved owned test post/comment.
- **Statistics:** every rendered metric/chart tooltip/table/dimension against the golden source; null-status and domain no-op variants; all date/entitlement/role/filter/error combinations; complete live historical opening reconciliation. API arithmetic has substantial positive evidence, but most frontend and negative variants are partial.
- **Supporting screens:** integration bulk assignment/source truth, shared CRM library reference edits, catalog cross-screen consistency and complete role/tenant/write-family checks; source-backed plan status/period/AI allowance/failure variants; zoom/orientation/keyboard/asset/error/restart matrices.
- **Release integration:** newer account foundation and subsequent cofounder branches need their own migrated isolated baseline and acceptance. This run does not waive proposed product/formula decisions.

## Cleanup and evidence retention

Disposable statistics databases were stopped/removed by their integration harness. Mocked-browser contexts closed without provider actions. Real-backend suites used newly created synthetic businesses/accounts; those synthetic local-development records remain unless the root explicitly performs safe fixture cleanup. No destructive shared-database reset is claimed.

Root restored the own live thread to bot handling and observed the fresh resumed answer. Approved outgoing/incoming QA message history and read receipts remain as unavoidable disclosed effects. No actual page credential/disconnect, owner password/MFA, real customer order/payment/shipping or unapproved public comment/moderation operation is claimed. Root owns the final initial-versus-final live source-state audit.

This report and CSV are documentation-only reconciliation: no browser interactions, tests, provider calls or customer writes were performed by the reporting agent while preparing them. Raw private screenshots/credentials were neither copied nor committed.
