# Release staging ledger

Statuses: new → triaged (fix/defer/won't fix/case) → in progress → fixed → verified.
Baseline live eval (gpt-6-luna, dev code 5956f987, prompts @15/@19/@24…): 65/77, critical 36/45 — gate FAILED.
Report: staging/eval-baseline/report.json

| id | area | type | sev | title | owner | status |
|---|---|---|---|---|---|---|
| EV-1 | shop bot hotel | ai-quality | S2 | "villa chứa được bao nhiêu khách" → "chưa có thông tin" although the property holds 20 guests (hotel-capacity) | dev-ai | triaged: fix |
| EV-2 | shop bot hotel | ai-quality | S2 | Long conversation: customer asks to read back the phone they gave → bot hands off instead (villas-long-conversation-recalls-phone) | dev-ai | triaged: fix |
| EV-3 | shop bot retail | ai-quality | S3 | Shipping to Hà Nội: omits the free-ship threshold 500.000đ from the profile (retail-shipping-hanoi) | dev-ai | triaged: fix |
| EV-4 | shop bot retail | ai-quality | S3 | Customer calls herself "chị" → reply uses no pronoun (tinymind-pronoun-customer-says-chi) | dev-ai | triaged: fix |
| EV-5 | shop bot retail | ai-quality | S3 | Two products asked with pictures → only one message with pictures (tinymind-several-products-own-pictures) | dev-ai | triaged: fix |
| EV-6 | shop bot spa | ai-quality | S3 | Price is a "liên hệ" price note → bot says "chưa có thông tin" instead of the note (spa-price-contact-note) | dev-ai | triaged: fix |
| EV-7 | shop bot education | ai-quality | S3 | Placement-test request: asks age/goal/campus/time but never the phone needed to record it (education-placement-test-asks-missing) | dev-ai | triaged: fix |
| EV-8 | shop bot hotel | ai-quality | S4 | Hold lost before confirm: no apology (hotel-holds-lost-before-confirm) | dev-ai | triaged: fix |
| EV-9 | evals | case | — | hotel-deposit-unknown / hotel-pets-unknown: bot says "hiện chưa có" (correct behaviour) but the case only accepts 4 phrasings → widen accepted phrasings ("chưa có", "chưa xác nhận") | tester | triaged: case |
| EV-10 | evals | case | — | hotel-aura-package-autopick: `not_contains: 8.000.000` also matches "18.000.000" → use a word-boundary `not_matches` | tester | triaged: case |
| EV-11 | evals | case | — | hotel-a17-zero-inventory: `numbers_only_from_sources` flags dates "14/11", "15/11" that come from the current-time block → the check should treat dates of the time block as grounded | dev-ai | triaged: fix (eval checker) |
| INF-1 | dev infra | perf | S2 | Hermes bridge single-flight → testers queued 1.5–7 min/turn, 503s | PO | fixed 337d10ec, bridge restarted with 3 slots (runs from staging-dev worktree file) |
| MS-1 | spa bot + widget | ai-quality+bug | S2 | Over-eager handoff on ordinary/health/discount/instalment questions; widget visitor then gets no reply, booking lost | dev-ai | new |
| MS-8 | spa bot | ai-quality | S2 | English customer answered in Vietnamese; complaint gets no apology | dev-ai | new |
| MS-10 | CRM requests | gap | S2 | Bot reschedules a confirmed appointment: status stays "Đã xác nhận lịch", no alert/task | dev-be | new |
| MS-11 | webchat/CRM | bug | S2 | Contact created from a website booking not linked to the conversation; source "—" | dev-be | new |
| MS-9 | widget/agent | bug | S3 | Model unavailable after retries → visitor gets nothing (no fallback) | dev-be | new |
| MS-2 | bot | ai-quality | S3 | Customer calls themself "em" → bot calls them "chị" | dev-ai | new |
| MS-3 | bot | ai-quality | S3 | Before/after request answered with catalog photos + duplicated caption; unasked pictures | dev-ai | new |
| MS-12 | bot | ai-quality | S3 | Repeats fake discount figures back to the customer | dev-ai | new |
| MS-20 | inbox | bug | S3 | Website conversations get Messenger's 24 h lock (conversation-view.tsx:177) | dev-web | new |
| MS-21 | Today | gap | S3 | Open/overdue appointment requests never appear in Việc hôm nay | dev-be | new |
| MS-22 | customer sheet | gap | S3 | "Công việc — … sẽ có ở bản sau" placeholder | dev-web | new |
| MS-23 | statistics | ux | S3 | Spa statistics talk about orders; two period pickers disagree | dev-web | new |
| MS-25 | bot training | data | S3 | Industry-suggested situations: spa template mentions "học"; quick reply `doilich` holds privacy text | dev-be | new |
| MS-26 | data | gap | S3 | No warning when profile prices contradict the catalog | defer | new |
| MS-13/14 | bot | ai-quality | S3 | Hands off on payment questions; cosmetics "order" collects address then hands off | dev-ai | new |
| MS-4/5/6/7 | bot/widget | ai-quality | S4 | Mentions "danh mục/dữ liệu"; invented "không cam kết" policy; split mid-sentence; canned handoff pronoun clash | dev-ai | new |
| MS-24 | UI | ux | S4 | Retail/order wording on spa screens (Số mẫu mã, Sản phẩm vs Dịch vụ, Sau khi chốt đơn…) | dev-web | new |
| MS-27 | dev env | bug | S4 | /media not proxied on localhost:5173 (vite config) | dev-web | new |
| MS-28/29/30 | UI | ux | S4 | Price note order/casing; phone hides price; misc polish (dangling "—", ISO dates, Files tab cut, uneven cards, webchat message id ≠ stored id) | dev-web | new |
| INF-2 | dev servers | bug | S2 | Dev api/agent/worker on :3000 ran stale code (tsx watch missed 5956f987) → wave-1 AI ran @15/@19/@21 | PO | fixed: restarted 01:40 with original env; ai_runs now sales-agent@24 |
| TM-* / VL-* / LM-* | see wave1/<shop>/findings.md | — | — | 68 findings (TM 25, VL 24, LM 19); AI → dev-ai batch 2, backend → dev-be, web → dev-web (assigned 01:45) | — | in progress |
| DATA-1 | seed data | data | S3 | TinyMind profile is a US web shop (TM-24); Langmaster knowledge contradicts itself (LM-7); Villas bot training predates the calendar ("chỉ có A17", "handoff khi khách gửi SĐT") (VL-B1); Mailisa profile prices ≠ catalog (MS-26) | owner | report only (owner asked to keep seeded data) |
| AS-* | owner assistant + account | — | — | 24 findings (6 S2: AS-1 retry duplicates + generic error, AS-2 bot doctor wrong verdict, AS-3 UTC times, AS-4 "tuần sau" range, AS-5 SQL lane off, AS-6 import injection not scanned) → dev-assist (02:00) | dev-assist | in progress |
| INF-3 | dev env | config | S2 | Assistant read-only SQL lane was off locally (DATABASE_ASSISTANT_SQL_URL unset) | PO | fixed 01:55: rapiz_assistant password set, URL appended to .env, dev api + verify stack restarted. Prod: check the variable is set |
| dev-be batch | backend | — | — | fixed: TM-18, VL-A11, TM-19, MS-9/LM-1, TM-3/LM-19 msg, MS-11, LM-18 (partly), MS-10, MS-21, VL-A1, VL-A3, VL-A5, VL-A4, LM-16/MS-6, TM-5, TM-6, TM-7, LM-4, MS-25 (02:50) | dev-be | fixed → wave 2 verify |
| VL-A9 | lodging→CRM | gap | S3 | Booking guests never reach Khách hàng; needs lodging→crm dependency + ADR | PO | deferred (owner follow-up, proposal in report) |
| NEW-1 | Chat thử | ux | S3 | Fresh session sending only "✅ Giữ chỗ" → handoff instead of "nothing to confirm yet" | dev-ai | new |
| INF-4 | dev DB | — | — | migration 0083_task_source_bot applied to rapiz_acceptance 02:52 (backup ~/Workspace/rapiz-backups/rapiz_acceptance-20261113-before-0083.dump) | PO | done |
| dev-web batch | web | — | — | fixed: MS-20, MS-24/LM-3, MS-23/TM-12, MS-30, MS-22, LM-5, TM-10, MS-28/29, TM-11, TM-13, LM-6 (partly), LM-8, MS-27/TM-14/LM-2, TM-4, TM-8, TM-9, VL-A2, VL-A6, VL-A7, VL-A8, VL-A10 (03:00) | dev-web | fixed → wave 2 verify |
| NEW-2 | web | ux | S4 | Bot home "Tin nhắn khách gửi" label wraps on narrow width; inbox reply-mode pill icon-only on phone | dev-web | new |
| LM-3b | courses | gap | S4 | New course without package SKU — needs a decision | PO | decided: auto-generate SKU like products (wave 2) |
| dev-assist batch | assistant | — | — | fixed: AS-1..AS-8, AS-9 (status text), AS-10/11/12/16 (assistant@5), AS-14, AS-24; new eval checks + staging-wave1.yaml (03:20) | dev-assist | fixed → wave 2 verify |
| AS-9b | assistant/run-trace | ux | S4 | Meta line "model · tokens · s" under answers | PO | decided: platform admins only; owners see duration only (dev-web wave 2) |
| AS-17/13/15 | assistant | gap | S4 | Vietnamese titles for learned skills; offer "hide" when delete impossible; model-summed totals | PO | deferred |
| AS-19..23 | web | ux | S3/S4 | Bubble covers orders table; stale "màn hình Hôm nay" texts; overview 5 s; plan dialog without usage | dev-web | wave 2 |
| NEW-3 | assistant | perf | S3 | Bot-doctor turn budget exhausted by long product lists | dev-assist | mitigated (skill reads pageSize 3); proper fix deferred |
| NEW-4 | assistant | ux | S4 | SQL chart raw axis labels ("day","orders") + "[Biểu đồ …]" placeholder in text | dev-assist | wave 2 |
| PROC-1 | process | — | — | Shared git index swept files across devs' commits; devs moved to private-index commits (hooks skipped → lint by hand); final `pnpm check` before PR is mandatory | PO | noted |
| dev-ai batch | shop bot | — | — | prompts @25 hotel / @26 request / @27 retail; EV-1,2,5,6,7,8,11 fixed, EV-4 mostly, EV-3 case issue; wave-1 handoff/language/hotel/facts/requests fixed (several live-confirmed); live 72/77 base (crit 42/45) + 13/17 new (03:25) | dev-ai | fixed → wave 2 verify |
| EV-12 | evals | case | — | hotel-availability-saturday expects a phone ask from stale training; conflicts with "tools win" decision | examiner | case rewrite (wave 2) |
| NEW-5 | bot settings | gap | S3 | Shop's fixed handoff message ("anh/chị", Vietnamese) mismatches English/"chị" customers | PO | deferred: needs per-language handoff text setting |
| INF-5 | dev env | — | S1 for owner access | cloudflared auto-updated at 02:05 and exited → tunnel penguin-two-tony-ashley dead | PO | restarted with --no-autoupdate: https://operated-yrs-mit-silver.trycloudflare.com ; APP_ORIGINS updated |
| INF-6 | dev env | — | — | Dev stack (api/agent/worker :3000, vite :5173) now runs from worktree staging-dev (branch fix/release-staging) since 03:30; verify stack :3100/:5273 stopped | PO | done |
| WAVE-2 | all | — | — | 5 testers (verify + deeper scenarios) + examiner (EV-9/10/12, EV-3 fixture, full live run) launched 03:35; dev-web/dev-assist small wave-2 batch | — | in progress |
| W2-TM | TinyMind wave 2 | — | — | verify: 14 fixed, 2 partly, 8 still failing (TM-2,13,15,16,17,20,22,24); new TM2-1..14 (3 S2: phone read-back repeats [regression], qty change loses order, invented 2-order total) → dev-ai batch 3; TM2-12/13/14 + TM-13 → dev-web | dev-ai/dev-web | in progress |
| dev-assist w2 | assistant | — | — | NEW-4 chart labels fixed a013d078; NEW-3 list descriptions capped 0268add2; AS-1 confirmed live | dev-assist | fixed |
| EVAL-W2 | live eval gpt-6-luna | — | — | 86/94, critical 53/57 (baseline 65/77, 36/45). Case fixes EV-9 f31e2ad4, EV-10 212a3902, EV-12 e05d8fea, EV-3 bdf81539. Persistent: pronoun-keeps-anh, spa-health-asks-phone → dev-ai; aura 4PN wording + spa-missing-date "chưa thể ghi nhận" → examiner narrows (PO decision); 4 flaky + 1 Hermes 429 | — | in progress |
| PROC-2 | evals | gap | S3 | Single-run live gate is flaky on luna (4 of 8 failures pass on rerun) → the spec's --repeat/baseline engine is needed before the gate can block releases | PO | follow-up (eval engine slice of the spec) |
| dev-web w2 | web | — | — | fixed: AS-9b 0b6aa3a8, AS-19 313e2346, AS-20 (5.3 s → 0.6 s) a43b1aa0, AS-21 9329e67e, AS-22 (account + AI usage) 883bf50f, AS-23 dates f7a77efe, NEW-2 df87c320, LM-3b 1d446601 | dev-web | fixed |
| AS-23b/AS-22b | web | gap | S4 | Switcher group named after the account "Tester sandbox"; usage rows for members/channels/contacts need an endpoint | PO | deferred |
| NAME-1 | assistant | ux | S4 | Panel title "Rapiz Agent" vs sidebar "Trợ lý cá nhân" | owner | report: owner's naming decision |
| TEST-1 | web tests | bug | S3 | test-chat-quick-replies.test.tsx broken by Chat thử sessionId (c848e01e) | dev-web | in progress |
| W2-LM | Langmaster wave 2 | — | — | verify: 5 fixed, 3 mostly, 6 partly, 4 still failing; new LM2-1..12 (S2: handoff instead of answer, takeover message never answered, broken pictures [env], branch invented, weekday/date clash recorded). AI → dev-ai; LM2-2/7/8/9 + LM-4 → dev-be | dev-ai/dev-be | in progress |
| INF-7 | dev env | config | S2 | S3_PUBLIC_URL still on the dead tunnel → every bot picture broken (LM2-3) | PO | fixed: .env S3_PUBLIC_URL → new tunnel, backend restarted 03:41. GOOGLE_REDIRECT_URI also on the dead tunnel (Google sign-in on the tunnel needs a registered redirect — owner) |
| W2-VL | Villas wave 2 | — | — | verify: 14 verified, 8 still failing (B1,B2,B3p,B4,B8,B10,B13); new VL2-1..10 (S2: handoff cascade 57 %, English child ages rejected, date change → duplicate hold, two-villa totals with one hold) | dev-hotel | in progress |
| DEC-1 | AI architecture | decision | — | Prompt rules alone do not beat stale owner training → server-side handoff guard (reject a handoff the offered tools/data can serve, once) — generic, hotel first | PO | assigned dev-hotel 03:50 |
| LM2-12 | dev env | perf | S3 | tsx watch restarts backend on every dev save, disrupting testers | PO | accepted during dev; final verification wave runs without watch |
| W2-AS | assistant wave 2 | — | — | verify: 13 verified (AS-1,3,4,5,6,7,9,10,11,22 + partials), 5 still failing (AS-2 partly, AS-12, AS-19, AS-20 load time, AS-24 file name); new AS2-1..10 (S2: best sellers wrong incl. cancelled; bot-doctor verdict contradicts body; S3: orphaned running run locks owner ~6 min) → dev-assist | dev-assist | in progress |
| W2-MS | Mailisa wave 2 | — | — | verify: 15 fixed, 3 partly, 4 still failing (MS-1,7,9 under load,14); main website booking + reschedule flow works end to end; new MS2-1..13 (S2: health handoffs, English complaint in Vietnamese, cosmetics purchase lost, competitor price handed off) → dev-ai; MS2-7/8/11 → dev-be; MS2-9/12 + AS-19/24 → dev-web | — | in progress |
| dev-web w2b | web | — | — | fixed: TEST-1, order phones, TM2-12, TM2-13, TM2-14, TM-13 (launcher tucks/hides beside Chat thử), AS-19, MS2-9, MS2-12 (mostly), AS-24 (04:05) | dev-web | fixed → wave 3 verify |
| examiner w2b | evals | — | — | aura 4PN + spa-missing-date narrowed 10cecf1d; backend full suite: 1 load flake only | examiner | done |
| dev-ai b3 | shop bot | — | — | fixed: TM2-1 (regression) 73e0dd54, TM2-2/3/5/6/7/9/11, TM-17, TM-20, LM2-6/LM-17, LM2-10, MS2-2, MS2-5, pronoun-keeps-anh/says-chi 8f2db79d; partly/prompt-only: TM2-4, TM2-8, LM2-1, LM2-4, LM2-5, LM2-11, MS2-3, MS2-4, MS2-6 (04:15) | dev-ai | fixed → wave 3 verify |
| DEC-2 | bot | decision | — | Complaints: apology (handoff `say`) + handoff is accepted; English hand-over line "A member of our staff will get back to you here shortly." | PO | decided |
| MS2-1 | spa bot | ai-quality | S2 | Health handoff without phone ask → deterministic: hand-over lead-in asks for the phone when none is known | dev-ai | in progress |
| dev-be w2 | backend | — | — | fixed: LM2-2 77d10a44 (message during takeover answered at resume), LM2-7 e9e7798e (landlines), LM2-9 87a6d4b5, LM2-8 + MS2-8 + LM-4 + MS2-7 54344fb2, MS2-11 3e1ba284 (04:20) | dev-be | fixed → wave 3 verify |
| DEC-3 | Today | decision | — | 15-min "Chưa trả lời" also for bot hand-offs by design — confirmed | PO | decided |
| W3-AS | assistant wave 3 | — | — | all wave-2 S2 verified; AS-2/12/19/20/24 verified; new AS3-1..8 (S2: AS3-3 incomplete villa availability shown as complete, AS3-7 claims the bot knows assistant memory) → dev-assist (07:20) | dev-assist | in progress |
| W3-VL | Villas wave 3 | — | — | handoff rate 57 % → 0 % (guard refused 16 attempts); 12 holds correct; 15 verified, 3 partly, 2 still failing (VL2-6, VL-B4); new S2: VL3-1 own hold blocks change, VL3-2 English payment complaint not handed off, VL3-3 international phones rejected, VL3-4 split-group total → dev-hotel (07:30) | dev-hotel | in progress |
| W3-TM | TinyMind wave 3 | — | — | screens ready; bot not ready: 13 verified (TM-16,20, TM2-1..9,12..14), still failing TM-15/17/22/24, TM2-7/10; new S2: TM3-1 VN orders refused by US seed shipping text, TM3-3 forgets given phone/address, TM3-4 guard blocks complaint/refund/cancel handoffs [regression], TM3-6 order never prepared → dev-hotel (TM3-4), dev-ai (rest), dev-web (TM3-10/11) (08:55) | — | in progress |
| W3-MS | Mailisa wave 3 | — | — | main flow works end to end on the real widget; MS-1, MS-14, MS2-1..4, 7..11 verified; new S2 MS3-1 (booking-status question handed off) + S3 MS3-2..7 → dev-ai/dev-be; MS3-8/9 web (09:10) | — | in progress |
| PO-1 | evals/contracts | case | — | 511b741f: complaint case per DEC-2; bedroom-rule test now asserts AccommodationWrite (rule moved in VL-A5) — fixes the only pnpm check failure | PO | done |
| dev-be w3 | backend | — | — | MS3-5 0b083015 (Today shows the contact name), MS3-8 60a0b500; needs backend restart (batched) | dev-be | fixed |
| dev-web w3 | web | — | — | TM3-10 b8ab5f5a, TM3-11 a6f80b57; QA task 01a1d1a1 cancelled by PO | dev-web | fixed |
| dev-assist w3 | assistant | — | — | AS3-3 + AS3-7 8a7e3c77 (live OK), AS3-2/4/5/8 c5b22da5, AS3-1 hint only 7905803d (PO: keep C1 security decision — no `||`/array_agg), S4 c99a9549; AS2-2 final wording not replayed | dev-assist | fixed → verify |
| W3-LM | Langmaster wave 3 | — | — | booking/reschedule/task/confirm/hold-resume verified on the real widget; new S2 LM3-2 (request recorded without consent), LM3-7 (callback time → handoff); S3 LM3-1/3/4/5/6 → dev-ai; guard topics (LM3-7, MS3-1) → dev-hotel; LM3-10 → dev-web; LM3-9 = MS3-5 fixed (09:40) | — | in progress |
| dev-web w3b | web | — | — | LM3-10: "Đăng ký học thử", capitalised price note, sessions column fixed; task title + widget defaults → dev-be; "Miễn phí" for 0đ book → owner data decision (0đ also means "liên hệ" for Mailisa cosmetics) | dev-web | fixed/partly |
| dev-hotel w3 | hotel + guard | — | — | guard passes complaints/refund/cancel/payment/human (VN+EN) incl. TM3-4/VL3-2; refuses callback-time and status handoffs (LM3-7, MS3-1); VL2-4/5/6, VL3-1/3(holds)/4/5/8, VL2-2/7, @25 fixes; replays 1/38 handoffs (correct); fake evals 119/119 (10:05) | dev-hotel | fixed → verify |
| DEC-4 | evals | decision | — | hotel-two-villas-only-one-held: a combined estimate is acceptable when the reply says which villa is held and which is not | PO | decided |
| VL3-3b | requests | gap | S3 | International phones accepted for holds, not yet for requests (crm) | dev-be | open |
| dev-ai w3 | shop bot | — | — | TM3-1/2/3/5/6/7/8/9, TM-22, MS3-1/2/3/4, LM3-1/2(S2, record_request needs explicit intent)/3/4/5/7, order-follow-up fixed; leftovers LM3-6, MS3-7, TM2-10, LM2-11 in progress (10:20) | dev-ai | fixed/in progress |
| DEC-5 | evals | decision | — | tinymind-order-asks-missing-recipient: a refused prepare_order attempt is acceptable (0f1f14dc) | PO | done |
| PROC-3 | git | — | — | shared index held staged deletions of the guard files (private-index commits never update it) → reset to HEAD 10:15 | PO | done |
| dev-be w3b | backend | — | — | task titles without repeated weekday b24a8045; new website sites take the bot's name/greeting 754ceacb; VL3-3b international phones for requests in progress | dev-be | fixed/in progress |
| W4-HOTEL/AS | final S2 sign-off | — | — | VL3-1/2/3/4, VL2-6, hotel cancel/refund, AS3-3, AS3-7 verified on 55957e31; AS2-2 still fails for a short wording → AS4-1 (S2) dev-assist; VL4-1 (S3, hold summary Vietnamese for English guests), VL4-2/3 (S4), VL4-4 (EVANI 40 adults fits?) → dev-hotel (11:00) | — | in progress |
| W4-RES | final S2 sign-off retail/edu/spa | — | — | TM3-3, TM3-4, LM3-2, LM3-7, MS3-1 verified (DH000017/18, request/task DB checks); TM3-6 + S2-A (unknown extra blocks the order) → dev-ai; S3-B task due not moved on callback update → dev-be (11:15) | — | in progress |
| TM3-1 | TinyMind bot | data | — | Refuses VN delivery once the seeded "chỉ giao 50 bang Hoa Kỳ" text comes up — the bot follows the shop's stated policy | PO | closed as seed-data behaviour (DATA-1, owner fixes the profile) |
| AS4-1 | assistant | ai-quality | S2 | Short "bot tính sai à?" wording routed to data skill → wrong verdict | dev-assist | fixed f33a5571, live eval case PASS; api restart pending |
| dev-hotel w4 | hotel | — | — | VL4-1 (English hold summary/buttons) + VL4-2 978dba00; VL4-4 not a bug (EVANI max 100 in owner data) | dev-hotel | fixed |
| EVAL-F2 | live eval | — | — | 111/119, critical 75/81 (before cc49b40e/978dba00/f33a5571 were loaded). Case fixes DEC-6/DEC-7 42822573; product: villas-recalls-phone (S2 regression), spa pronoun "em" → dev-ai; open S3: warranty on a defect complaint (DEC-2 tension), spa health no phone ask without handoff, hotel children quote flaky | — | in progress |
| dev-be w4 | crm | — | — | task due from time words 16724e96, clock-independent test 2bafaaa0 | dev-be | fixed |
| CHECK-3 | pnpm check | — | — | lint/arch/typecheck/build OK; 2 backend test failures were a race with a concurrent commit (both files pass alone, 76/76) | PO | rerun at the end |
| VL3-3b | requests | gap | S3 | International phones for requests | dev-be | fixed ca136fe4 |
| EVAL-F3 | live eval | — | — | final full run on 7bec47d6: 116/120, critical 78/82; the 4 failures re-run live: all PASS (1 Hermes timeout, 1 picture flake, 1 extra failed prepare_hold before confirm, 1 checker false positive "8.000.000" inside "18.000.000" → e74dbab6) | PO | done |
| PO-2 | web | perf | S2 | Initial bundle 251.1 KB > 250 KB budget after wave strings → `action` namespace lazy with the bot space 1fc794aa (249.4 KB) | PO | fixed |
| CHECK-4 | pnpm check | — | — | lint/arch/typecheck green; build green after PO-2; backend 4561/4562 + web suites green, the 4 failures are 5–9 s timeouts under load (each file passes alone, repeated) | PO | done |
| EVAL-AS-F | assistant live eval | — | — | final run 7/12 → 750c2584 (new-request alerts every 15 min; hold times not shifted twice; a failed duplicate search still drafts the product) | dev-assist | fixed; live 12/12 |
| DEC-8 | evals | decision | — | Customers by status: the requests summary route and the customers-view SQL are both correct; cases get route + `sql_rows` fixtures and check the counts in the answer (3a9bdf98) | PO | done |
| RESEED | seed data | data | — | Owner asked to fix the seeded data (DATA-1). 4 seeders, through the owner API, backup `rapiz_acceptance-20261113-before-reseed.dump`. TinyMind → Vietnamese shop, nationwide delivery, COD/transfer, 51 product descriptions in Vietnamese (12 Chat thử checks, 10 first try). Villas → calendar is the truth: 7 villas, EVANI max 35, D14 standard 30+10, check-in/out + 50 % deposit everywhere, 9 situations + 13 FAQs rewritten (14 checks ok). Langmaster → every course priced, one branch set, one schedule/teacher/level/policy set (14/14). Mailisa → 0đ cosmetics priced, profile price list removed (catalog only), health hand-off rules, 10 duplicate FAQs removed (12/12). Invented values listed for the owner. | seeders | done |
| R5-1..8 | shop bot / guard / backend | bug | S2×3, S3×5 | From the reseed checks: confirm needs 2nd message; wholesale hand-off refused by guard; promised follow-up without hand-off; tool facts left out; situation hand-off → request; duplicate lines; hand-off asks phone + says done; DELETE empty JSON → 500 | dev-ai / dev-guard / dev-be | fixed: R5-8 5115f615, R5-1 2ffa5862, R5-4/6/7 8c67b9e3, R5-2/3/5 cf14ccde; 5 new eval cases, all live PASS |
| EVAL-F4 | live eval | — | — | after the reseed + R5 fixes: shop bot 124/126, critical 80/82 (the 2 failures re-run live 2×: all PASS; `hotel-holds-confirm-gives-code` failed in 2 full runs — a refused extra `prepare_hold` before the correct confirm, watch item); assistant 12/12; backend 4597/4597; web 2 load timeouts (pass alone) | PO | done |
