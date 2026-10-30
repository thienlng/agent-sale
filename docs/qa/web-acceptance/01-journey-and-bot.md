# Journey, authentication and bot acceptance

Use the shared fixture/evidence rules in [the data guide](data-and-oracles.md). LIVE cases use only the owner's TinyMind conversation; registration, role/session mutation and bot configuration changes use isolated accounts. Each entry is a full case, not a claim of execution.

<a id="web-001"></a>

## WEB-001 — Landing entry points and dashboard return

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Public landing and logged-out test context.
- **Steps:** Open landing; click header login, return; click each trial CTA (header, hero, closing/demo); open auth-page logo. Repeat at 375px using the phone menu.
- **Expected result:** Login targets /login; trial targets /signup on the configured app origin; auth logo returns to marketing root. No dead localhost/old-domain link in the public tunnel; no accidental form submission.
- **Independent evidence:** Actual final URLs, navigation requests and visible destination headings; compare configured site/app destinations.
- **Cleanup:** No writes.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="web-002"></a>

## WEB-002 — Landing interactive content

- **Priority / environment:** P2 / ISOLATED.
- **Preconditions and data:** Production site, desktop and phone.
- **Steps:** Exercise every demo tab, demo dialog open/close, FAQ item, anchor, sticky header and back-to-top; use keyboard Escape and focus return.
- **Expected result:** Tabs change the intended content; dialog closes without navigating/submitting; FAQ is operable; anchors are not hidden under header; no trap or duplicate active panel.
- **Independent evidence:** Visible content/ARIA state and screenshots at top, middle and footer; browser errors.
- **Cleanup:** No writes.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="web-003"></a>

## WEB-003 — Landing theme and fonts

- **Priority / environment:** P2 / ISOLATED.
- **Preconditions and data:** Fresh context; both system color modes; storage-blocked variant.
- **Steps:** Check system initial theme; toggle manually; reload; synchronize another tab; block storage and toggle again; inspect Vietnamese text and font loading.
- **Expected result:** Space Grotesk body/headings and JetBrains Mono accents render Vietnamese; self-hosted font requests succeed; manual theme persists/syncs when storage works and remains usable if storage fails.
- **Independent evidence:** Computed fonts, loaded same-origin font files, visible diacritics and theme state; no third-party font assumption.
- **Cleanup:** Reset theme and close test contexts.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="auth-001"></a>

## AUTH-001 — Successful login and intended destination

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Dedicated authorized test user; logged-out context.
- **Steps:** Log in normally; reload; open a protected deep link while signed out then log in again.
- **Expected result:** Normal login reaches selected-business statistics; a safe explicit deep link is honored; refresh restores the authorized session, not a blank or unauthorized business.
- **Independent evidence:** Browser destination, bootstrap memberships and current workspace ID, protected requests without exposing tokens.
- **Cleanup:** Log out test account only.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="auth-002"></a>

## AUTH-002 — Invalid credentials and input validation

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Synthetic email/password; no real owner login attempts.
- **Steps:** Submit empty/malformed fields, then wrong password; double-click submit once; correct the credentials.
- **Expected result:** Field/form errors understandable; no misleading success or duplicate active request; controls recover and valid login works; password not in URL/log.
- **Independent evidence:** Sanitized request count/status and visible validation; no user-enumeration details disclosed.
- **Cleanup:** Close dedicated context.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="auth-003"></a>

## AUTH-003 — Registration and industry defaults

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Unique synthetic signup with outbound email disabled in harness.
- **Steps:** Complete signup; attempt invalid/duplicate input; inspect created workspace and initial home; open new-bot dialog.
- **Expected result:** One user/workspace for one accepted request; errors do not leave a partial active UI; supported workspace industry is retained and inherited by new bots. Any missing email-verification flow is recorded as known T-045 scope, not passed.
- **Independent evidence:** Identity/workspace/bot domain reads and bootstrap; no real email sends.
- **Cleanup:** Reset disposable account fixture.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="auth-004"></a>

## AUTH-004 — Session expiry and private state cleanup

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Test account A with draft; account B in same browser after controlled expiry.
- **Steps:** Expire/deny refresh; attempt protected navigation/send; sign in as B; repeat logout across two test tabs.
- **Expected result:** Expired session cannot send/read protected data; A drafts/private caches do not reappear for B; pending old-session callbacks cannot modify B state; intentional login redirect remains safe.
- **Independent evidence:** Scoped requests/statuses, visible draft state and storage-key lifecycle without dumping tokens or message contents.
- **Cleanup:** Reset synthetic users/contexts.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="nav-001"></a>

## NAV-001 — Selected business controls every sidebar screen

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Two authorized businesses A/B with deliberately different bots, contacts, products, channels and counts.
- **Steps:** Select A and visit each sidebar destination; select B and repeat; reload; use browser Back/Forward.
- **Expected result:** Statistics is first/default business home; every screen/request uses the currently selected business; no A row, title, action target or draft appears as B data; selection follows documented persistence.
- **Independent evidence:** Bootstrap membership, captured workspace request scope and fixture IDs, not title alone.
- **Cleanup:** Restore initial business and close QA context.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="nav-002"></a>

## NAV-002 — Switch during pending work or delayed responses

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** A/B, unsaved profile draft, in-flight mutation and intentionally delayed A read.
- **Steps:** Try switching with unsaved edits and cancel the guard; then switch after saving; switch while an A response is delayed; attempt switching during a mutation.
- **Expected result:** Cancel preserves A/draft; a permitted switch opens B home; in-flight mutation cannot be redirected into B; late A data never renders under B. Disabled switch is explained/consistent.
- **Independent evidence:** Request captured scope, persisted A/B records and delayed-response trace.
- **Cleanup:** Reset A/B fixtures.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="nav-003"></a>

## NAV-003 — Rapiz logo and portfolio entry

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Selected business recorded; two-business variant in isolation.
- **Steps:** Click Rapiz logo; inspect portfolio; open a business row; use browser Back.
- **Expected result:** Logo opens /app/overview without silently changing selected business; row opens that authorized business statistics; marketing site remains a separate account-menu link.
- **Independent evidence:** URL, sidebar selection and workspace requests; compare source membership list.
- **Cleanup:** Restore initial screen/business.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-001"></a>

## BOT-001 — Live inbound and bot outbound continuity

- **Priority / environment:** P0 / LIVE.
- **Preconditions and data:** L, bot active; record current own-thread status/mode and message IDs.
- **Steps:** Send one uniquely tagged greeting from Messenger; observe Rapiz without reload and external bot response; reload Rapiz and reopen the same conversation.
- **Expected result:** Exactly one stored inbound for the source message; the approved greeting policy must reach its expected terminal outcome: one delivered bot reply visible once on Messenger and Rapiz with bot attribution, or an explicitly configured handoff that is verified end to end. A missing terminal outcome cannot pass; investigate and record FAIL or BLOCKED with cause after the observation window. Conversation identity and full observed history survive reload.
- **Independent evidence:** Messenger plus scoped conversation/message source records; measure incoming/reply visibility times.
- **Cleanup:** Restore L; external QA exchange remains.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-002"></a>

## BOT-002 — Grounded product and follow-up question

- **Priority / environment:** P0 / LIVE.
- **Preconditions and data:** L and verified existing product K/variant/pricing/source revision.
- **Steps:** Ask about K, then ask its price/variant without repeating the name; compare every factual claim against the source.
- **Expected result:** Correct product context and known facts; no invented stock/price/variant/promise; source limitations respected. Exact AI phrasing is not required.
- **Independent evidence:** Approved catalog/training revision and both visible conversations, with claim-by-claim expected facts written before send.
- **Cleanup:** Restore L; keep test history.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-003"></a>

## BOT-003 — Unknown product and uncertain facts

- **Priority / environment:** P0 / LIVE.
- **Preconditions and data:** L, product U absent from catalog/training; approved fallback/handoff instructions recorded.
- **Steps:** Ask U price/availability, then request a definite delivery date that is not known.
- **Expected result:** No invented commercial facts or false order/shipping confirmation; clarification/fallback follows actual instructions. An unspecified fallback policy is DECISION_REQUIRED, not guessed.
- **Independent evidence:** Searchable approved knowledge/catalog baseline plus the response claims on Messenger.
- **Cleanup:** Restore L.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-004"></a>

## BOT-004 — Burst, multiline, emoji and context

- **Priority / environment:** P1 / LIVE.
- **Preconditions and data:** L; unique markers A/B, Vietnamese diacritics and emoji.
- **Steps:** Send two short messages close together, then one multiline message; inspect the whole thread after response completion.
- **Expected result:** Each source message retained once and ordered consistently; no missing characters or accidental split. Bot may batch responses; assess correct combined context and unintended duplicates, not an invented one-reply-per-input rule.
- **Independent evidence:** Source message IDs/order and Messenger rendering; record exact burst timing.
- **Cleanup:** Restore L.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-005"></a>

## BOT-005 — Temporary takeover and automatic resume

- **Priority / environment:** P0 / LIVE + ISOLATED.
- **Preconditions and data:** L/I; configured takeover duration recorded; controlled clock for the timing variant.
- **Steps:** Choose temporary human handling; send incoming QA message; answer from Rapiz; reload before expiry; observe expiry and send another message.
- **Expected result:** No bot reply while takeover is effective; human reply reaches Messenger once; countdown/state survives reload; after configured expiry bot handling resumes. No competing reply from an already-pending generation without the documented cancellation policy; ambiguity is escalated.
- **Independent evidence:** Mode/autoResumeAt source values, outbound actor, timed messages and provider outcomes.
- **Cleanup:** Restore L or reset I; do not shorten live global bot timing.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-006"></a>

## BOT-006 — Permanent takeover and explicit bot resume

- **Priority / environment:** P0 / LIVE.
- **Preconditions and data:** L, active bound bot, original mode recorded.
- **Steps:** Choose permanent human handling; send incoming message; wait through observation window; reload; explicitly resume bot and send another question.
- **Expected result:** Permanent human mode persists with no automatic timer; bot does not answer during it; after explicit resume the new supported greeting must receive its expected delivered bot reply or explicitly configured and verified handoff; mere eligibility is not PASS; human and bot attribution remain distinct.
- **Independent evidence:** Persisted mode/takeover fields, source outbound records and Messenger observation.
- **Cleanup:** Restore original L mode.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-007"></a>

## BOT-007 — Inactive or unassigned bot safeguards

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Dedicated QA page/channel, active/inactive/unassigned bot variants.
- **Steps:** Open reply-mode menu and bot management; try resume/temporary takeover in each variant; toggle QA bot from list and reopen training.
- **Expected result:** Unavailable bot modes disabled with reason; permanent human mode remains usable when permitted; list/detail switches agree after reload; errors roll back the switch.
- **Independent evidence:** Bot/channel domain reads and effective reply-mode requests; no live disconnect.
- **Cleanup:** Restore QA assignment/activation.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-008"></a>

## BOT-008 — Training facts versus instructions

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** QA bot with versioned synthetic knowledge and safe sandbox; no live delivery.
- **Steps:** Add/change one factual item and one behavior instruction through their own screens; save/reload; inspect validation/history; exercise bot sandbox.
- **Expected result:** Content saved in the correct section; fact claims and instructions do not overwrite one another; sandbox follows current approved data and does not create live conversation/statistics events.
- **Independent evidence:** Knowledge/bot domain reads and sandbox results; source outbox before/after confirms no live message event.
- **Cleanup:** Reset QA bot/training.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-009"></a>

## BOT-009 — Create bot inherits business industry

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Two supported industry workspaces; one legacy bot with different industry.
- **Steps:** Open create dialog in each business; submit; simulate missing/error workspace query; inspect existing legacy bot and profile.
- **Expected result:** New bot inherits that selected business industry with no independent conflicting picker; missing/error data blocks unsafe create and offers recovery; legacy bot is warned about without silent rewrite; profile industry is read-only.
- **Independent evidence:** Workspace and bot source reads, created bot IDs and legacy before/after.
- **Cleanup:** Remove/reset QA bots via fixture harness.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="bot-010"></a>

## BOT-010 — Read-only training, history and advanced settings

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Editor and non-editor accounts; QA bot with existing training/history/settings.
- **Steps:** Visit every visible training/settings tab; inspect loading/empty/error; edit one allowed safe setting; reload; repeat read-only and cross-business.
- **Expected result:** Settings persist for correct bot/business; restricted writes denied by backend as well as UI; history identifies actual change and actor; failures keep unsaved input or explain loss.
- **Independent evidence:** Bot/settings/history source records, actual capabilities and scoped write responses.
- **Cleanup:** Restore QA setting and accounts.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.
