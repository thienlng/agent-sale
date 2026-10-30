# Supporting screens, permissions and quality

These cases complete the cross-screen journey without assuming that unfinished cofounder account/shop contracts already exist. Additional controls discovered during execution must be added to the coverage map and given their own assertions before declaring the screen accepted.

<a id="crm-001"></a>

## CRM-001 — Contact list, search, filters and detail

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Synthetic same-name contacts with different phones/emails/sources/statuses/owners/tags, more than one result page.
- **Steps:** Test every visible list filter/search/sort/pagination; open selected contact by ID and deep link; combine filters; reset; try no-result and failed fetch.
- **Expected result:** Exact matching source IDs and count, no row lost/duplicated at page boundary; correct contact detail; no same-name auto-merge; loading/error distinct from empty; filter semantics recorded rather than inferred.
- **Independent evidence:** CRM domain source and independent fixture predicate per UI filter; list response alone not sole oracle.
- **Cleanup:** Reset filters.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="crm-002"></a>

## CRM-002 — Contact create/edit validation and history

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Disposable contacts and supported source/status/tag/member library.
- **Steps:** Create with minimum allowed fields; edit name/phone/source/owner/status; try invalid phone/duplicate/no-op/stale version; reload; inspect available history.
- **Expected result:** Valid edits persist once to correct ID/business; invalid input gets field-specific feedback; duplicate policy is explicit; stale writes do not silently overwrite; source events align with analytics eligible changes.
- **Independent evidence:** Persisted contact, allowed field policies, history/outbox and old/new values; no real contact details.
- **Cleanup:** Reset disposable contact fixture.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="crm-003"></a>

## CRM-003 — Customer settings shared libraries

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** QA tag/status/source entries, including same names in another business.
- **Steps:** Create/edit safe QA entry; inspect inbox picker and CRM; test blank/duplicate names, permission denied and in-use removal behavior through safe harness.
- **Expected result:** Libraries scoped to selected business; names/colors update where referenced; references retain correct IDs; prohibited/in-use deletion policy explicit; no silent deletion of assignment/history or unrelated business entry.
- **Independent evidence:** Settings records and referenced assignment IDs across inbox/CRM; actual capability response.
- **Cleanup:** Reset only QA library fixture; no live library deletion.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="chn-001"></a>

## CHN-001 — Integration list and bot fanpage view agree

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Two QA bots, assigned/unassigned QA pages in one business and a foreign business page.
- **Steps:** Inspect outer integration list and each bot fanpage tab; assign/unassign approved QA page through supported flow; reload both screens.
- **Expected result:** Single consistent source of assignments; each bot shows its actual channels; unassigned is not confused with disconnected; foreign page never eligible; bot active state remains separate from assignment state.
- **Independent evidence:** Channel connection/bot binding source IDs, not only matching UI text.
- **Cleanup:** Restore QA bindings.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="chn-002"></a>

## CHN-002 — Bulk bot assignment and filters

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** QA pages P1/P2 assigned differently and P3 unassigned; active/inactive QA bot.
- **Steps:** Filter unassigned/by bot; select several eligible pages; bulk assign; simulate one failure; clear/unassign; inspect bound-bot view.
- **Expected result:** Only selected eligible pages affected; result counts honest; retry does not affect success/unselected pages; labels distinguish assign/unassign from connection activation; unknown shop restrictions remain deferred.
- **Independent evidence:** Per-page binding before/after, batch response and filter set oracle.
- **Cleanup:** Restore all original QA bindings; no live page reassignment.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="chn-003"></a>

## CHN-003 — Channel states, settings and safe failures

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Connected/disconnected/reconnect-required/expired QA connection plus owner/restricted role.
- **Steps:** Read page details/settings; toggle allowed QA setting, save/reload; fail save; inspect reconnect affordance without performing real OAuth; test foreign connection ID.
- **Expected result:** State reasons accurate; failed save not falsely applied; appropriate capability gates enforced; foreign resource404; reconnect does not claim success before provider completion.
- **Independent evidence:** Connection/settings source and permission statuses; zero real OAuth/token changes.
- **Cleanup:** Restore settings/fault fixture.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="commerce-001"></a>

## COMMERCE-001 — Catalog consistency across bot, inbox and orders

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** QA product with two variants/prices and stock levels; dedicated QA bot/catalog.
- **Steps:** Open product detail/list, bot product view, inbox sharing and order draft; change QA price/variant in allowed screen then refetch.
- **Expected result:** Same variant ID/name/price/availability rules; saved source changes propagated on refetch; no stale/foreign product shown as current; sandbox bot claims match accessible catalog policy.
- **Independent evidence:** Catalog source records, bot product-selection contract if present, inserted message and order draft integer amounts.
- **Cleanup:** Reset QA catalog; no live product mutation.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="commerce-002"></a>

## COMMERCE-002 — Order overview and detail source consistency

- **Priority / environment:** P1 / CONDITIONAL.
- **Preconditions and data:** Disposable persisted QA orders under approved isolated-only order scope; known statuses/amounts/dates.
- **Steps:** Open order list/overview/detail; apply each visible filter; compare totals and item snapshots; inspect inbox session-order panel distinction.
- **Expected result:** Exact order set and integer totals; list/detail/overview agree on source status/time filters; changed catalog does not rewrite saved item snapshot; session panel not sold as full order history.
- **Independent evidence:** Order source records and independent quantity/unit-price/discount/shipping arithmetic under actual field policy.
- **Cleanup:** Reset disposable orders; external carriers/payments disabled.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="acc-001"></a>

## ACC-001 — Header account panel and navigation

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Current T-120 header avatar; selected business recorded.
- **Steps:** Open avatar; inspect identity, plan/billing, security, display/language, marketing home and logout row; open subview/back/Escape; close plan/layout dialog.
- **Expected result:** Panel anchored to avatar, no central account-switch popup; business picker only in sidebar; closing dialog restores avatar focus; marketing home and Rapiz logo have distinct correct destinations; no logout unless isolated.
- **Independent evidence:** Visible UI, focus target, URLs and selected business unchanged.
- **Cleanup:** Close panel/dialog and return to original screen.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="acc-002"></a>

## ACC-002 — Theme, language and advanced layout combinations

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Production web build; supported layout settings enumerated from current controls; 375/768/1280/1920 widths.
- **Steps:** Exercise every available combination of sidebar style/collapse, content width and navbar position; theme/system/language; reload; reset advanced layout.
- **Expected result:** All controls effective/persisted per documented preference scope; content/header/composer usable, no page-level horizontal overflow; reset layout does not reset unrelated theme; report T-122 harness timeout separately with actual product evidence.
- **Independent evidence:** Computed dimensions, storage/preferences, screenshots per combination and browser errors; no timeout increase to fabricate pass.
- **Cleanup:** Reset QA preferences/viewport.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="acc-003"></a>

## ACC-003 — Plan popup truthfulness and missing usage

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Read-only current entitlements; isolated null/unlimited, zero, trial/active/past_due/suspended/canceled, absent AI allowance and error variants.
- **Steps:** Open plan popup; verify name/status/end date and every present limit; switch business; retry failed fetch in isolation.
- **Expected result:** Displayed plan/limits/AI allowance amount and period equal source; null means unlimited, absent means absent, zero stays0; no fabricated usage/progress bar or claim of account-wide ownership while account billing not integrated.
- **Independent evidence:** Authorized entitlements source, effective workspace scope and independently formatted dates/integers.
- **Cleanup:** Close popup; no plan purchase or entitlement change live.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="acc-004"></a>

## ACC-004 — Business profile versus personal security

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Two workspaces and dedicated user; profile/settings/security routes.
- **Steps:** Open profile, inspect name/industry, save allowed QA name; switch business; open personal security and attempt invalid input in safe harness.
- **Expected result:** Business profile scoped correctly; industry inherited/read-only as designed; personal security is user-scoped and not falsely renamed as business settings; restricted changes denied; account secret never exposed.
- **Independent evidence:** Workspace source and identity scope/capabilities; profile save/history without sensitive data.
- **Cleanup:** Restore QA workspace name; no owner password/MFA change.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="team-001"></a>

## TEAM-001 — Members and effective capability boundaries

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Synthetic memberships for actual roles; invitation delivery disabled.
- **Steps:** Inspect member list; compare capability matrix; attempt approved test role change/invite only in isolation; test restricted direct writes and foreign member ID.
- **Expected result:** Only current business members visible; role/capability changes enforced server-side; invitations/seat restrictions reflect actual entitlements; no foreign membership disclosure; unsupported workflows recorded, not passed.
- **Independent evidence:** Membership/capability/entitlement source and denied write effects.
- **Cleanup:** Reset QA memberships/invitations; do not send real invitations.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="qlt-001"></a>

## QLT-001 — Desktop, mobile, zoom and keyboard usability

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Separate QA browser for resizing; landing/login/inbox/CRM/statistics/settings/plan populated states.
- **Steps:** Use widths375/768/1280/1920, portrait/landscape and200% zoom; navigate with keyboard; open long-label menus, filter popovers, sheets and composer.
- **Expected result:** No page-level horizontal overflow; intentional inner tab/table scroll usable; list/thread/back/details transitions work; composer/send not obscured; visible focus/labels and modal focus return; meaningful content not truncated without access.
- **Independent evidence:** Viewport/scrollWidth/clientWidth, screenshots and keyboard/focus trace on each listed screen.
- **Cleanup:** Restore viewport/zoom; no owner Chrome size change unless needed.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="qlt-002"></a>

## QLT-002 — Loading, empty, errors and retry across screens

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Each primary screen with no records, slow request,401/403/404/409/429/500 and disconnected network where applicable.
- **Steps:** Exercise each state independently for list/detail/mutation; retry after recovery; navigate between records/businesses during delay.
- **Expected result:** Error reason/action appropriate; no empty-success disguise; unsaved input preserved where recoverable; stale results never under new identity; retry does not repeat already-accepted external mutation.
- **Independent evidence:** Fault-specific sanitized request/status and source before/after; named per-screen result rows.
- **Cleanup:** Remove all faults/reset fixtures.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="qlt-003"></a>

## QLT-003 — Network interruption, reconnect and polling

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Two-tab QA context, controlled API/provider faults; unsent and sending drafts.
- **Steps:** Go offline before send, after acceptance and while reading; return online; suspend/resume background tab; introduce new message during reconnect.
- **Expected result:** No lost draft or duplicated send; explicit pending/unknown when outcome uncertain; polling resumes without duplicate list/thread rows; no stale-status overwrite; measured timing recorded without invented SLA.
- **Independent evidence:** Provider stub accepted-call ledger and source IDs, browser online/network state and final persisted text.
- **Cleanup:** Reset network/context.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="qlt-004"></a>

## QLT-004 — Cross-tenant and role-negative coverage

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** R matrix: actual capability allowed/denied for inbox, CRM, bot, channel, analytics, commerce, team and settings.
- **Steps:** For every scoped object screen, try foreign ID via URL and direct test request; for every write family try role without required capability; revoke membership with screen open.
- **Expected result:** Foreign object404 or documented non-disclosing authorization response; explicit permission denial for own-business unauthorized action; no data/cache leaks or source mutation; provider stub not called. Existing intended aggregate visibility tested against documented contract.
- **Independent evidence:** Per-module role matrix with capability names, source before/after and sanitized responses; cover all listed module families.
- **Cleanup:** Reset roles/memberships; never attack unrelated real tenant.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="qlt-005"></a>

## QLT-005 — Console, failed assets and UI-to-server evidence

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Browser console/network recording with token/content redaction; navigation through approved screens.
- **Steps:** Capture app exceptions, unhandled rejections, failed JS/CSS/font/media and unexpected API failures during every case; reproduce any error after reload.
- **Expected result:** No unhandled crash in core flow; broken remote media has fallback; expected negative-test errors distinguished from unplanned failures; useful source IDs for diagnosis without secrets/PII in logs.
- **Independent evidence:** Sanitized console errors, exact asset/request URLs with sensitive query parts removed and screenshot context.
- **Cleanup:** Stop recording; store raw live evidence privately.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="qlt-006"></a>

## QLT-006 — Local storage limits, expiry and denied storage

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Synthetic browser drafts, clock and capacity fixture; no owner storage tampering.
- **Steps:** Exercise7-day text-draft expiry,100-draft capacity, attachment/session-only behavior, blocked writes/removals and corrupted stored JSON; switch user/logout.
- **Expected result:** Expired/excess drafts pruned per policy; current valid text not silently claimed persisted after failure; warning and in-memory editing remain; private state invalidated across users/sessions; attachments not promised durable reload restoration.
- **Independent evidence:** Controlled fixture clock, draft manifest and scoped storage transitions; no real message text in git.
- **Cleanup:** Delete QA storage/contexts.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="qlt-007"></a>

## QLT-007 — Restart/reload persistence and production build parity

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Recorded saved/unsaved state matrix; production build as well as dev server; isolated API restart permitted.
- **Steps:** Reload each screen; close/reopen browser context using saved session; restart only isolated API; revisit links on production preview and tunnel.
- **Expected result:** Persisted domain state survives; session-only selections/notes/order drafts are not falsely promised durable; no automatic send on rehydrate; assets/routes/auth fallback work in production, not only HMR dev.
- **Independent evidence:** Saved source manifest, before/after UI and build SHA; request/provider send count across restart.
- **Cleanup:** Restore isolated servers; do not restart shared live services.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="qlt-008"></a>

## QLT-008 — Final cleanup and release evidence audit

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Run complete; initial L state manifest and execution ledger.
- **Steps:** Restore saved own-thread settings; clear only unsent QA drafts; enumerate unavoidable external/history effects; verify every required case has evidence and each bug retest links to a fix SHA.
- **Expected result:** Original operational mode/assignee/status/priority/follow-up restored; no pending ambiguous send retried blindly; no real order/plan/page credential changes; summary states PASS/FAIL/BLOCKED/deferred counts honestly.
- **Independent evidence:** Initial/final source comparison, actual ledger and retained private evidence; no blanket completion from smoke-test counts.
- **Cleanup:** Close dedicated QA contexts; leave owner app usable.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.
