# Release staging 2026-11-12/13 — report

The last staging pass before real users, run by an agent team on the owner's seeded dev data (account
`tester.assistant@rapiz.test`, businesses TinyMind (retail), Tam Dao Villas Central (hotel), Langmaster (education),
Mailisa (spa)) with `gpt-6-luna` through the Hermes bridge. Design: `docs/superpowers/specs/2026-11-12-agent-quality-suite-design.md`.
Item-by-item record: [ledger.md](ledger.md).

## How it ran

- Product owner (Claude) triaged, decided and accepted; 5 testers (one per business + the owner assistant), 1
  examiner (eval cases), developers per area (shop-bot AI, hotel bot, backend, web, owner assistant).
- Four waves: wave 1 explore (long realistic conversations, every screen desktop 1440 + phone 390), wave 2
  verify + deeper scenarios, wave 3 final verification on a stack without file watching, wave 4 S2 sign-off +
  final live evals.
- Rule kept throughout: testers never edit product code; developers never edit a case's `expect`, tags or
  thresholds. Case changes (EV-9, EV-10, EV-12, EV-3 fixture, aura/spa narrowing, DEC-2 complaint case, DEC-5..8) were PO
  decisions executed by the examiner, each recorded in the ledger.

## Numbers

| | wave 1 | wave 2 | wave 3 | final (wave 4) |
|---|---|---|---|---|
| New findings | 116 (≈28 S2, 0 S1) | 59 | 21 | 6 (all fixed) |
| Live eval, shop bot | 65/77, critical 36/45 (old prompts) | 86/94, critical 53/57 | 100/109, critical 65/71 | 116/120, critical 78/82; the 4 failures re-run live: 4/4 pass |
| Live eval, owner assistant | — | — | — | 7/12 → 12/12 after 750c2584 + DEC-8 |
| Hotel bot hand-off rate on replays | 53 % | 57 % | 0 % (server guard refused 16 attempts) | 1/38 (a justified one) |

Of the 4 final shop-bot failures: 1 model timeout through the bridge, 1 missing picture, 1 extra refused
`prepare_hold` before the confirm, 1 checker false positive ("8.000.000" matched inside "18.000.000", fixed in
e74dbab6). Single live runs on `gpt-6-luna` stay noisy; see "Needs the owner".

Fake evals: shop bot 120/120, assistant 12/12. `pnpm check`: green — backend 4564/4564, web 1557/1557 (a few web/backend tests hit their 5–9 s
timeouts only when the machine is under eval load; each passes alone and on repeat).

Branch `fix/release-staging`: ~158 commits, ~405 files. Prompts `sales-agent@25` (hotel), `@26`
(saas/education/spa), `@27` (retail), `assistant@6`. 120 shop-bot eval cases (was 79) + 12 assistant cases.

## After the report: data reseed and wave 5

The owner asked to fix the seeded data. Four seeders made each business consistent through the owner API (the
catalog and the lodging calendar are the truth; profile, knowledge, FAQs and bot situations follow them), keeping
every conversation, order, booking and "QA" item; a DB backup was taken first. Values the seeders had to invent
are listed in the ledger (RESEED) for the owner to confirm or replace. The clean data exposed 8 product bugs
(R5-1..8: a plain yes did not confirm an order, wholesale hand-offs refused, untriggered staff promises, figures
dropped by the repeat filter, duplicate lines, hand-off order and pronoun, situation hand-offs recorded as
requests, empty JSON body → 500), all fixed with 5 new eval cases. Final live run: shop bot 124/126 (critical
80/82, both failures pass on re-run), assistant 12/12; backend 4597/4597.

## Most important fixes

- **Trust / consent:** Chat thử sessions no longer share order/hold drafts (a test chat could confirm another chat's
  real order); customer-written order notes are quoted, never stored as staff facts; imported spreadsheet cells
  are scanned for injected instructions; a server-side hand-off guard stops the bot from passing answerable
  questions to staff because of stale owner training.
- **Customers never left hanging:** model failure on a real conversation sends the hand-over message and alerts
  staff; a message sent while staff hold a chat is answered when the bot resumes; handed-off conversations show
  in the inbox and Việc hôm nay; the owner assistant fails fast with "AI đang bận" + Thử lại and frees the owner
  after a restart.
- **Correct records:** website contacts are linked to their conversation with source Website; bot requests open
  staff tasks due at the requested slot, closed on confirm, shown on the customer sheet; a rescheduled confirmed
  appointment returns to the request status; a new bot hold replaces the guest's earlier one; free toddlers no
  longer make a villa "not fit"; landlines accepted.
- **Language and tone:** English customers get English; replies split only at sentence ends; one phone read-back;
  complaints get an apology; no repeated pictures or captions; pronouns mirror the customer.
- **UI:** ~45 fixes (industry wording for service businesses, one statistics period, orders/bookings on phone,
  website conversations without the Messenger 24 h lock, Vietnamese formats, overview 5.3 s → 0.6 s API time).

## Still open (go/no-go)

Verdict: **go for a supervised beta on all four verticals and the owner assistant**. Every S1/S2 found in waves
1–4 is fixed and verified (hotel S2s VL3-1..4, VL2-6; assistant AS3-3, AS3-7, AS4-1; retail/edu/spa TM3-3/4/6,
LM3-2/7, MS3-1). "Supervised" because the bot runs on a single model whose single-run results vary by a few
cases; keep staff watching hand-offs for the first weeks.

Open, S3 and below (in the ledger):

- Warranty answer on a defect complaint (tension with DEC-2 "apologise + hand off"); spa health question without
  a hand-off does not ask for the phone; hotel children quote is flaky on live runs.
- Seed-data driven behaviour (TinyMind US-only shipping, TM3-1) — closed on our side, the owner fixes the profile.
- Bot-doctor turn budget with long product lists (NEW-3, mitigated).

## Needs the owner

- Seeded data that hurts answers (not changed, as asked): TinyMind profile reads like a US web shop; Villas bot
  training predates the calendar; Langmaster knowledge contradicts itself; Mailisa profile prices ≠ catalog;
  EVANI max guests 100; 0đ items read as "Miễn phí" vs "liên hệ".
- Deferred features: booking guests → Khách hàng (needs an ADR, VL-A9); per-language hand-over text (NEW-5);
  Vietnamese titles for learned skills (AS-17), hide instead of delete (AS-13), model-summed totals (AS-15);
  account switcher naming and usage rows (AS-22b/23b).
- Naming: assistant panel "Rapiz Agent" vs sidebar "Trợ lý cá nhân".
- Production config: `DATABASE_ASSISTANT_SQL_URL` must be set (the SQL lane was off locally); `GOOGLE_REDIRECT_URI`
  in the local `.env` still points at the dead tunnel. The single-run live gate is noisy on luna — build the
  `--repeat`/baseline engine from the design before gating releases or comparing models on it.

## Environment changes made during the run (dev machine)

Dev stack runs from worktree `.claude/worktrees/staging-dev`; Hermes bridge runs that worktree's `bridge.py` with
`HERMES_BRIDGE_CONCURRENCY=3`; quick tunnel restarted with `--no-autoupdate`
(`https://operated-yrs-mit-silver.trycloudflare.com`); `.env` gained `DATABASE_ASSISTANT_SQL_URL` and a new
`S3_PUBLIC_URL` host; migration 0083 applied to the dev DB (backup in `~/Workspace/rapiz-backups/`).
