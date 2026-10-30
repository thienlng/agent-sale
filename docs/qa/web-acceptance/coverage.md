# Coverage and execution handoff

## Control inventory

The rows are screen acceptance obligations, not a list of supposedly implemented missing features. Enumerate any newly discovered control at execution time; do not pass a screen with an unmapped active control.

| Screen / control family | Detailed cases |
| --- | --- |
| Landing CTA, menu, demo tabs/dialog, FAQ, anchors, theme, fonts | WEB-001..003 |
| Login/signup/redirect/session expiry | AUTH-001..004 |
| Sidebar business picker, route guard, Rapiz logo, portfolio business entry | NAV-001..003; ANA-027..028 |
| Bot text reply, factual grounding, unknown data, message bursts | BOT-001..004 |
| Bot/human permanent/temporary mode and expiry | BOT-005..007; INB-023 |
| Bot list switch, inherited industry, training facts/instructions/history/advanced settings | BOT-007..010 |
| All messages/Messenger/Instagram/Website/Facebook comments tabs and unsupported entries | INB-001; COM-001..006 |
| List preview/avatar/time/provider/selection | INB-002; INB-012 |
| List search, unread, waiting/longest/read-not-replied, priority/follow-up | INB-003..006 |
| Advanced filter Apply/Close/Reset, active badges, removable chips | INB-007 |
| ANY/ALL/EXCLUDE/untagged | INB-008 |
| Assignee/mode/page/phone filters | INB-009 |
| Header spam/priority/unread/done/reopen and more-menu search/external link | INB-004/006/010/012/036 |
| Header assignee selection | INB-011 |
| Thread grouping/time/sender/delivery, search, scroll and latest | INB-012 |
| Text send/length/whitespace/thumbs-up | INB-013..014 |
| Composer preference, IME, drafts/reload/two tabs | INB-015..017; QLT-006 |
| Quick replies/slash/emoji/product/attachment preview/remove/send | INB-018..020 |
| Failed/pending/unknown/retry, send remount and eligibility gates | INB-021..023 |
| Customer panel profile/collapse/sections/tag/settings link | INB-024/027/028/036 |
| Customer phone/copy/tel link/new-lead state | INB-038 |
| Notes add/multiline/author/time/history | INB-025 |
| Follow-up date/note/save/edit/clear/timezone | INB-026 |
| Shared photos and source open | INB-027 |
| CRM search/select/profile, status and CRM tags | INB-028..029; CRM-001..003 |
| Order panel/draft/stock/product/source/submit/session-created rows | INB-030..031; COMMERCE-001..002 |
| J/K, /, R, E, T, U, dialog and editor exceptions | INB-032 |
| Manage/select-visible/cancel and all bulk actions/partial retry | INB-033..034 |
| Saved view save/apply/delete/capacity/storage failure | INB-035 |
| Notification enable/default/granted/denied | INB-037 |
| Comment page/post/search/older-posts/older-comments selectors | COM-001 |
| Comment source/parent/external link/freshness/history | COM-002 |
| Comment public/private/PII confirmation/eligibility | COM-003 |
| Comment pending/unknown/retry/check-status and hide/unhide | COM-004..005 |
| Comment action permission versus fanpage automation permission | COM-006 |
| Every statistics metric help/card | ANA-001..013 |
| Every chart selector/date/tooltip, every table row and nonadditive total | ANA-014..015 |
| Date presets/custom/month/range validation and URL | ANA-016..017 |
| Statistics origins/Sales/page filters, applicability and reset | ANA-018..020 |
| Card/row drilldown, total, link, older rows and watermark | ANA-021..022 |
| Statistics loading/error/retry/zero/locked/forbidden/unavailable | ANA-023..026 |
| Portfolio totals/chart/rows/retry/partial scope/freshness | ANA-027..029 |
| Absolute live reconciliation and absent indicators | ANA-030..031 |
| Integration list/bulk bot assignment/unassigned/by-bot filter/bot channel view | CHN-001..003 |
| CRM list/detail/customer settings | CRM-001..003 |
| Catalog/order overview/list/detail | COMMERCE-001..002 |
| Avatar account menu/back/Escape/marketing link/security | ACC-001/004 |
| Theme/language/layout/plan popup/source limits | ACC-002..003 |
| Member/role/invitation controls | TEAM-001 |
| Mobile/zoom/keyboard, network/error recovery/permission/cache isolation | QLT-001..007 |
| Restore operational state and acceptance report | QLT-008 |

## Twelve-metric completeness check

| Key | Exact numerical case |
| --- | --- |
| conversations.opened | ANA-002 |
| customers.new | ANA-003 |
| phones.captured | ANA-004 |
| tags.assigned | ANA-005 |
| tags.removed | ANA-006 |
| tags.net | ANA-007 |
| tags.current | ANA-008 |
| statuses.changed | ANA-009 |
| statuses.current | ANA-010 |
| messages.inbound | ANA-011 |
| messages.outbound | ANA-012 |
| comments.received | ANA-013 (source unavailable; do not show successful zero) |

## Execution slices

1. **Review gate:** approve live message scope and fixture rules; identify any unresolved metric definitions. Document-writing does not itself send messages.
2. **Live end-to-end:** WEB-001, NAV-003, BOT-001..006 (with isolated timing variants separate), INB live-marked own-thread cases and ANA-030 when full source access exists. Leave global configuration unchanged.
3. **Isolated numerical acceptance:** load G once, freeze manifest, execute ANA-001..029 and reset only variant fixtures between cases. Run calculations independently before reading actual cards.
4. **Isolated function/fault acceptance:** I/R/C plus bot/catalog/CRM fixtures; all control cases, roles, same-name identity, multi-tab, uncertain send and partial bulk errors.
5. **Production/mobile regression:** repeat affected journeys at supported viewports and in built assets; execute remaining site/app tests as supporting evidence with exact backend/mock distinction.
6. **Fix cycle:** record failing cases as tracked bugs; fix only authorized scope; rerun original cases and adjacent source/tenant/delivery regressions on fixed SHA; retain original failing row.
7. **Owner acceptance:** present per-group pass/fail/blocked/not-implemented/decision-required totals, observed delays, exact outstanding product decisions and irreversible test effects.

## Known exclusions requiring explicit release scope

No real delete/block/report, no actual purchase/payment/shipping, no unapproved public comment or moderation, no real-account password/MFA/role/page-credential changes. No assertion of unavailable shop filters, account billing migration, cross-device drafts, direct upload or full historical order linkage. A future merged feature gets new concrete cases before release; it does not inherit PASS from this baseline.
