# Release staging: agent quality suite, per-agent model bench and full-product test — design

- Date: 2026-11-12 (supersedes the 2026-11-11 draft that never landed)
- Status: spec complete, **not started** — the owner gives the start signal
- Product owner: Claude (delegated by the owner: "bạn vào vai chủ sản phẩm… không cần hỏi ý kiến tôi… xong hết cho
  tôi một cái báo cáo")
- Related: docs/13 §2, `apps/backend/evals/README.md`, `docs/qa/web-acceptance/`, ADR-005 (tiers), ADR-010 (Hermes),
  ADR-015 (harness v2), ADR-024 (owner assistant), ADR-030 (brain), ADR-031 (care)
- Inspiration, not a compliance target: the VTNET "AI Agent technical criteria" method (register thresholds before
  measuring, score by script, report per scenario group, block release on regressions, four test layers, six
  security risk groups).

## 0. Starting point (checked 2026-11-13)

- `main` is at `fbda822f` (#180). Since the first draft, the following landed:
  - #172: bot action permissions;
  - #173: injection hardening, plus an eval-only pre-send number guard (ADR-032, off by default);
  - #174: auth hardening;
  - #178: Today merged into Statistics;
  - #179/#180: deletion (ADR-033, migrations up to `0080`).
- 79 YAML eval cases are on `main`.
- Open PRs that touch this plan:
  - **#181** adds `sales-agent@22/@23/@24` ("the catalog wins over the hand-written profile").
  - **#175** meters every model call (`common/limits/llm-budget.ts`); the eval usage capture builds on it rather than
    duplicating it.
  - **#176** also touches `llm-admin.controller.ts`.
  - #175 claims migration `0079` and #176 claims `0078`, but `main` already has `0079`/`0080`. Migration and ADR
    numbers for this programme are therefore taken at implementation time, from the latest `main`.
- Slices start from the latest `main`, after #175/#176/#181 merge or are rebased. The first gate run uses whatever
  prompt versions are current then, and records them in the baseline.
- The pre-send guard (ADR-032) is part of the reply path under test. Gating runs record whether it was on.

## 1. What this is

This is the **last staging pass before Rapiz goes to real users**. A small agent team works through the whole
product on a realistic, seeded staging environment, with the product owner (Claude) running the team. It ends in a
go/no-go decision and one report to the owner.

It has three outcomes:

1. **A product ready to ship.** Every feature has been exercised on realistic data. Bugs and missing pieces that
   matter have been fixed, or written down with a reason.
2. **A permanent regression gate for the AI agents.** The gate reports pass/fail per group and lists the cases that
   regressed against a baseline. Every later prompt, tool, code or model change goes through it.
3. **A model bench for each agent.** When a new model ships, one command tells us, for each agent separately:
   - whether the model is good enough;
   - whether it is cheaper or faster than the model we run today.

   AI changes too fast to guess six months ahead. The bench is how Rapiz keeps up without hand comparisons.

## 2. The team

| Role | Who | Owns | Never does |
|---|---|---|---|
| **Product owner (PO)** | Claude, main session | Scope, priorities, the findings ledger, triage, acceptance of each slice, the go/no-go call, the final report | Writes product code or cases itself (it reviews and decides) |
| **Seeder** | Agent (Opus 5.5) | The staging dataset: seed scripts, fixtures, resets, data realism, and keeping the data in step with features | Changes product behaviour; fixes code |
| **Tester** | Agent(s) (Opus 5.5), fresh context per assignment | Eval cases (as examiner), agentic `e2e` tests, live Playwright tests, bug bashes, regression and bench runs, verifying fixes | Edits product code; relaxes a check, a threshold or a `critical` tag to make something pass |
| **Developer** | Agent(s) (Opus 5.5) | Eval engine, per-agent routes, fixes and missing features from the ledger, docs and ADRs for its changes | Edits a case's `expect`, its tags or the thresholds |
| **Reviewer** | Fresh-context agent per PR (`review-pr` skill) | Independent review before a PR is marked ready | Reviews its own work |

Rules of collaboration:

- **Separation of duties.** The tester's cases describe intended behaviour: the docs, the prompts' stated rules and
  product sense. They are not fitted to today's output.
  - A failing case is a **finding**. It is never a reason to soften the case.
  - When the developer thinks a case is wrong, it says why in the ledger and the PO decides.
- **Hand-offs go through the ledger, not chat.** Every task, finding and decision has an id there. Agents read it
  at the start of an assignment and update it at the end.
- **One owner per branch.** Developer and tester never commit to the same branch at the same time.
  - Test changes and behaviour fixes are separate commits, so the PR shows "case added → found → fixed".
- **The PO accepts each slice.** Acceptance means:
  - the reviewer has passed it;
  - `pnpm check` is green;
  - the tester has re-run the affected suites.

  Only then is the PR opened. Merging stays with the maintainer, as the repo rules require.

## 3. The findings ledger

`docs/qa/release-staging/ledger.md` lives in the repo, so every agent and the maintainer see the same truth. It has
one row per item:

`id | area | type | severity | title | found by | owner | status | link (case/test/PR)`

- **type:**
  - `bug`
  - `gap`: a missing feature or behaviour
  - `case`: the case is disputed
  - `ux`
  - `perf`
  - `security`
  - `data`: the seed is wrong or missing
- **severity:**
  - **S1:** data loss, cross-tenant leak, money wrong, an obeyed injection, a write without consent, a crash on a
    main flow.
  - **S2:** a main flow is broken or wrong for a common case, or the bot invents facts.
  - **S3:** wrong in an edge case, or confusing UX.
  - **S4:** polish.
- **status:** `new → triaged (fix / build / defer / won't fix + reason) → in progress → fixed → verified`.
  - Only the tester moves an item to `verified`, by re-running its case or test.

**PO triage policy:**

- **S1 and S2:** always fixed before go.
- **S3:** fixed when the fix is cheap or the area is user-facing on day one. Otherwise deferred with a reason.
- **S4:** batched or deferred.
- **A missing feature** is built only if a real shop would hit it in the first weeks *and* it fits the existing
  direction (docs, ADRs, the Agentic Business OS phases already shipped). Anything larger is recorded as a
  follow-up for the owner.

## 4. Staging environment and data

### 4.1 Environment

- **Database:** a dedicated `rapiz_staging` database on the local Postgres. The dev database is shared with other
  agents' work and with the owner's tunnel, so staging never touches it.
- **Code:** the staging stack (api, agent, worker, web, widget host page) runs from a dedicated staging worktree on
  the branch under test. Other checkouts are not affected.
- **LLM:** a real model through the Hermes provider, configured in `rapiz_staging`. Hermes is the owner's ChatGPT
  subscription, so live volume is capped: see the budget in §9.
- **External services:**
  - No sends to real Facebook Pages. Messenger flows use recorded webhook fixtures and the website widget.
  - Email uses the dev mail outbox. No real payments.
- **Reset:** one command drops, migrates and seeds `rapiz_staging` to a known state. Every test run can start
  clean.

### 4.2 The seeded world

The seeder builds **synthetic but realistic** data. Names, phones and addresses are generated; nothing is copied
from real customers. The world has one account per vertical that Rapiz sells to. Each shop is complete enough that
every screen has something real to show:

| Shop | Vertical | Must contain |
|---|---|---|
| Shop thời trang | retail, orders on | ~60 products with variants, stock in 2 warehouses, images; FAQs, profile, situations; order statuses and sources; ~150 customers with tags and stages; ~120 orders across every status; Messenger and website conversations (bot-handled, handed off, staff-taken); one owner webhook action |
| Homestay / villa | hotel | 3 properties with units, packages, weekday rates, overrides and policies; calendar with bookings and bot holds waiting for review; conversations about availability |
| Trung tâm tiếng Anh | education | courses (offering) with schedules; requests (trial class, consultation) in every status |
| Spa | spa | services with durations; appointment requests, some updated within 24 h |
| SaaS | saas | plans and subscriptions; demo requests |
| Second account | retail | a separate tenant whose data must never appear in the first account (isolation checks) |

Across shops the seed also includes:

- **Team:** an owner, a manager and a sales member with distribution rules.
- **Brain:** signals and Today queues (follow-ups, approvals, tasks).
- **Care:** enrollments and drafts waiting for approval.
- **Assistant:**
  - threads, memory entries (including a deleted one) and a learned skill;
  - a schedule;
  - an import file containing an injected instruction.
- **Other:**
  - a KiotViet connection in a fake state;
  - an audit trail, notifications and data-export history;
  - plan and usage near a quota limit.

Seeder deliverables:

- `pnpm seed:staging` with `--reset` and `--shop <name>`. It is idempotent and goes through the application
  services or APIs where practical, so the data obeys the same rules as real data.
- A `docs/qa/release-staging/dataset.md` map: what exists, with stable names and ids that tests can refer to.
- Fixture helpers that eval cases and tests reuse, so catalogs and customers are not retyped in every YAML.

## 5. Agents under test and per-agent routes

Every LLM call site belongs to one **agent key**. The key is what the bench compares and what routing resolves.

| Agent key | Call sites | Today |
|---|---|---|
| `shop_bot` | reply loop and history summarizer | `bot.modelTier` (plan) |
| `assistant` | chat turn, review, import vision | `pro` |
| `assistant_light` | compaction, schedule commentary | `basic` |
| `care_writer` | care follow-up writer | `basic` |
| `brain` | signal evaluator, reply draft | `basic` |

**Per-agent routes (new ADR, next free number — ADR-034 as of 2026-11-13):**

- **Table:** a new `llm_agent_routes (agent pk, provider_id, model, effort, fallback_*, updated_by, updated_at)`.
  `agent` takes the keys above except `shop_bot`.
- **Resolution:** `GenerateRequest` gains an optional `agent`. The gateway uses the agent's route when one exists,
  and the tier route otherwise. With no agent rows, behaviour is exactly today's.
- **`shop_bot`:** stays on tier routes, because its tier is a plan feature (Smart/Pro/Neo). The tier routes *are*
  the shop-bot routes, and the bench recommends one model per tier for it.
- **Admin:** `/admin/llm` gains an "Agent routes" section where each agent gets a provider, model and effort, or
  "use tier".
- **Call sites:** every call site passes its agent key.

## 6. Eval engine

The existing commands keep working. They share one run core.

```
pnpm --filter @agent-sales/backend eval | eval:assistant | eval:care | eval:brain
  [--live] [--group g] [--id x]
  [--candidate <provider>:<model>[@effort]]…  [--repeat n]  [--judge <provider>:<model>[@effort]]
  [--save-baseline]  [--max-cost-usd x]  [--yes]  [--out dir]
pnpm --filter @agent-sales/backend eval:bench --agent <key> [--tier t] [--candidates-file …]
```

- **Candidate override.** `--candidate` builds a gateway on the named provider, using its key from the database.
  Every route points at that model and fallback is off, so a failure is the candidate's own.
- **Usage and cost.** Each result carries its tokens. `apps/backend/evals/prices.yaml` holds the API list price per
  model id, per 1 M tokens.
  - Hermes runs on a subscription, but its cost is still reported at the API price of the same model, because
    that is what production will pay.
  - A model missing from the price table shows its cost as "unknown" and is not ranked on cost.
- **Repeats** (`--repeat n`):
  - A critical case passes only if every repeat passes.
  - A common case scores its pass fraction.
  - Cases that give mixed results across repeats are listed as flaky.
- **Judge.** A case can carry an optional `expect.rubric` (Vietnamese allowed). A judge model scores it from 1 to 5.
  - The judge is fixed for the whole run and is never one of that run's candidates. A case passes the rubric at
    4 or higher.
  - Fake mode skips the judge, so PR CI stays offline.
  - A critical case never relies on the judge alone.
- **Answer checks for every agent.** The assistant, care and brain suites get the same checks the shop bot has:
  text, numbers only from sources or tool results, which tools ran, and which proposals were made. They also get
  structured-output checks: stage, mood, opt-out, skip/send.
- **Fault modes.** The in-memory facades can be set to `timeout`, `error` or `bad_shape` per tool, so failure
  paths become cases.
- **Baselines.** Stored at `apps/backend/evals/baselines/<agent>/<candidate-slug>.json`. They hold per-case verdicts
  and group rates, with no reply text.
  - Every run is compared with its baseline. The run prints, per group, now, before and the delta.
  - It lists the **regressed cases** with the failed check and the reply, and the newly passing cases.
- **Gate:**
  - critical = 100 %;
  - the overall common pass rate is at least 90 %, and no more than 2 points below the baseline;
  - group-level rules apply only to groups of 10 or more cases;
  - every regression is listed whatever the verdict;
  - exit code 1 on failure.
  - A gating run uses `--repeat 3`.
  - A baseline is saved only from a run that passed the gate.
- **Cost guard.** A live run prints an estimate and waits for `--yes`. `--max-cost-usd` stops the run once spending
  passes the cap.

## 7. Model bench and the selection rule

`eval:bench` writes `bench.md` and `bench.json` for one agent (and one tier, for `shop_bot`).

- **One row per candidate:**
  - critical n/m over all repeats;
  - common pass rate;
  - rubric mean;
  - cost per case;
  - latency P50 and P95;
  - number of flaky cases.
- **Eligible:** critical = 100 % over all repeats.
- **Recommended:** the cheapest eligible candidate. When costs are within 10 % of each other, the one with the
  faster P95 wins. "No eligible candidate" is a valid answer.
- **Disagreements:** the cases where candidates disagree, for a human to read.
- **Validity:** every row must have the same cases, prompt versions and judge. Otherwise the bench refuses to rank.

Candidates are listed in `apps/backend/evals/candidates.yaml`, so adding a new model is one line. Results are kept
as dated notes in `docs/qa/model-selection/`. The bench recommends; changing a production route stays a deliberate
admin action that passes the gate.

## 8. Coverage plan

### 8.1 Agent evals (tester writes cases; developer fixes findings)

- **shop_bot** (77 → ≥ 200 cases). The existing groups, plus:
  - `injection-indirect`: product text, FAQ, situations, post or page context, action responses
  - `tool-failure`
  - `tool-scope`
  - `data-leak`
  - `jailbreak`
  - `out-of-scope`
  - `actions`
  - `drafts`: cancel or edit an order or hold
  - `website`: cards, `suggest_next`
  - `comments`
  - `english`
  - wider `handoff`
  - rubric checks for tone and pronouns
- **assistant** (3 → ≥ 60):
  - answer text grounded in tool results
  - `proposals`: no write without a proposal; approve, reject, expiry, target drift
  - `memory`: poisoning through customer text; a deleted entry is not reused
  - `skills`: chat-created skills, injection
  - `sql`: read-only, scope, injection
  - `pii`
  - `navigation` and `form-fill`
  - `bot-doctor`
  - `api-action`: never asks for secrets in chat
  - `import-injection`
- **care_writer** (0 → ≥ 20):
  - skip vs send
  - persona and pronouns
  - length
  - fenced injection
  - opt-out
  - grounded in the shop's facts
- **brain** (0 → ≥ 30): labelled transcripts for stage, mood, needs-a-person and opt-out, plus a rubric for the
  reply draft.

Case rules:

- Synthetic data only, reusing the seed fixtures.
- One behaviour per case.
- Tag a case `critical` when its failure is a trust problem: invented facts, an obeyed injection, another
  customer's data, or a write without consent.

### 8.2 Product (UI and API) — tester on seeded staging

- **Live Playwright** for the flows that have no live test today:
  - bots and training, and Chat thử (real API)
  - assistant proposal approve and reject
  - Today approvals and care drafts
  - data export and deletion
  - booking create and edit, and bot hold review
  - product create and edit
  - customer requests (education and spa)
  - SaaS plans
  - developers (API keys, webhooks)
  - billing and quota states
  - Google sign-in return paths
  - notifications
- **Agentic `e2e`** (e2e-inc/e2e, Apache-2.0, `apps/web/e2e-agentic/`, manual runs only, ADR in the same PR) for
  flows an AI must play:
  - a customer chats in the widget and orders;
  - the owner asks the assistant for work, then approves or rejects;
  - the first progress signal appears within 5 s in the assistant and in Chat thử.
- **Bug bash** with `e2e explore`, one charter per area: inbox, orders, catalog, lodging, CRM and requests, bots,
  channels, Today and care, assistant, settings and team, admin. Every bug found comes with a repro test.
- **The `docs/qa/web-acceptance/` catalogue** is executed and its execution ledger updated. Cases worth keeping are
  automated.
- **Non-functional checks on seeded volume:**
  - API P95 on list screens;
  - first progress signal;
  - a responsive pass on key screens at desktop and mobile;
  - tenant isolation between the two accounts.

### 8.3 Criteria map

`docs/qa/agent-criteria.md` maps the VTNET method to Rapiz, one row per criterion:

- the criterion, and which agents it applies to;
- what Rapiz does today;
- which cases or tests exercise it;
- the threshold;
- the gaps.

The `audit-agent` skill walks this map.

## 9. Constraints and budget (PO decisions)

- **Live LLM volume.** Hermes is a personal subscription with quota and ToS risk.
  - The tester runs fake mode by default.
  - Live runs happen only for gating and bench runs, with a global cap of about **2 000 model calls per staging
    day**.
  - Bench runs use at most 3 candidates per agent and `--repeat 3`, on a bench subset of about 60 shop-bot cases
    and about 30 for each other agent.
- **No real external sends:** no Facebook Pages, no real customers, no real payments.
- **Disk.** The machine has about 4 GB free, so at most two worktrees exist at once. Build outputs are cleaned
  between slices.
- **Shared machine.** Other agents use the main checkout and the dev database. The staging work never switches
  their branch, kills their processes or writes to their database.
- **Repo rules:** one branch and one PR per finished slice, `pnpm check` green, ADRs and docs in the same PR. Never
  push to `main`.

## 10. Plan of work (one PR per slice; after the owner's start signal)

| # | Slice | Lead | Then |
|---|---|---|---|
| 0 | Staging env + seeded world + ledger skeleton | Seeder | Tester smoke-checks every screen has data |
| 1 | Eval engine (candidate, usage/prices, repeats, baselines, gate, shared core, answer checks, fault modes) | Developer | Tester re-runs the 77 cases |
| 2 | Per-agent routes (new ADR), call sites, admin UI | Developer | Tester covers it with a live admin test |
| 3 | Judge, bench, candidates file; `eval-agents`, `compare-models` skills | Developer | — |
| 4 | shop_bot cases → findings → fixes | Tester → Developer | Tester verifies |
| 5 | assistant cases → findings → fixes | Tester → Developer | Tester verifies |
| 6 | care_writer + brain suites → findings → fixes | Tester → Developer | Tester verifies |
| 7 | Live Playwright gaps, agentic `e2e` (ADR), `verify-rapiz`, bug bash → findings → fixes | Tester → Developer | Tester verifies |
| 8 | Bench of available models per agent; criteria map + `audit-agent` | Tester, PO | PO writes the model-selection note |
| 9 | Go/no-go and the final report | PO | — |

Slices 0, 1 and 2 can run in parallel: they touch different files. Each later slice starts when its dependencies are
accepted.

## 11. Go / no-go

Rapiz is **go** when all of these hold:

- no open S1 or S2 in the ledger;
- every agent passes its gate on its chosen model;
- the bench has a recommended model for every agent, or a stated reason why not;
- every main flow has passed on seeded staging:
  - signup → business → bot → training → Chat thử → widget → customer message → bot reply → takeover → order;
  - lodging hold → review;
  - request → follow-up;
  - assistant → proposal → approve;
  - Today and care approval.
- tenant isolation has been verified;
- `pnpm check` is green on every merged slice.

## 12. Final report to the owner (Vietnamese)

- **The verdict:** go or no-go, and why.
- **What was built:**
  - the suite and the bench;
  - per-agent routes;
  - the skills;
  - the seeded staging environment.
- **What was tested:**
  - case and test counts per agent and area;
  - pass rates.
- **What was found and fixed:**
  - counts by severity;
  - the notable items.
- **What remains:** deferred items with reasons, and follow-ups that need the owner (money, legal, external
  accounts).
- **The model recommendation for each agent:** cost and latency, with the bench table attached.
- **How to use the suite from now on:** the skills, plus the three commands that matter.
