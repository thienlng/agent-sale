# 15 — Team workflow: two humans, many agents

> How the two human maintainers (`thienlng`, `tungdd7`) run a product that is mostly written by coding agents. This complements the rules in `.agents/rules/` (which bind agents) with the operating model for humans. Revisit after the first month; adjust via PR.

## 1. Roles

| Role | Who | Owns |
|---|---|---|
| Product owner | `thienlng` | `TODO.md` priority order, acceptance criteria, `docs/14-open-decisions.md`, product behavior, pricing, go/no-go for phases |
| Tech lead | `tungdd7` | Architecture guardrails (Rule 05), ADR acceptance, CI/infra/tooling, protected files, security review |
| Reviewer | both | Any PR. Each human is the **primary** reviewer for the areas above and **secondary** for the rest |
| Agent operator | both | Launching agents on tasks, answering their questions, keeping their sessions unblocked |

Either human can act in the other's role when needed; the table says who has the final word when they disagree. Record disagreements that matter in the task Log or an ADR, not in chat.

## 2. Operating loop

```
Weekly planning (45 min, humans)        Daily async (humans, 2 × 15 min)          Continuous (agents)
──────────────────────────────          ─────────────────────────────────         ─────────────────────
Backlog → Next (5–8 tasks)              Review queue: PRs waiting < 24 h          onboarding → start-task
Write/verify acceptance criteria        Unblock: answer questions in task Logs    plan → draft PR → implement
Size tasks (≤ 1–2 agent-days)           Merge green, approved PRs                 pnpm check → open-pr
Assign primary reviewer per task        Scan CI failures / Dependabot             respond to review
```

### Weekly planning

1. Review **Done** since last week: did anything merge that drifted from the docs or rules? Create fix tasks.
2. Groom **Backlog → Next**: pick 5–8 tasks, in priority order. For each: goal, scope/out-of-scope, verifiable acceptance criteria, linked docs, size. A task an agent cannot finish in ~1–2 days is split (`T-012a/b`).
3. Decide which tasks need a **plan review** (draft PR with plan before code): anything touching billing, auth, tenant isolation, AI prompts, migrations, integrations, or estimated > 1 day.
4. Assign a primary reviewer per task (write it in the task file `Links` or Log).
5. Check `Blocked`: every blocked task gets a human decision or is moved back to Backlog with a reason.

### Daily async

- **Review SLA: 24 hours** for a ready PR, **4 hours** for a blocking question from an agent during working hours. Agents waiting idle are the main waste in this model.
- Merge order: smallest/oldest green PR first. Squash merge; confirm the task file moved to `todo/done/`.
- If CI is red on `main`, fixing it is the top priority for whoever sees it first (agent task, `fix(ci)`).

### Running agents

- One agent session = one task = one branch. Use `git worktree` (or the tool's worktree mode) so several agents can run in parallel on the same machine without interfering.
- Start every session with the `onboarding` skill, then `start-task`. Do not paste requirements in chat that are not in the task file — put them in the file first so the next session sees them.
- Prefer **plan-first** for larger tasks: the agent pushes a draft PR with only the plan; a human comments "plan approved" (or edits the plan) before implementation. This is the cheapest point to catch wrong direction.
- Mix tools deliberately: the agent that implements and the agent that pre-reviews should be different (e.g. Claude Code implements, Codex runs `review-pr`, or vice versa). Humans read the agent review first, then the diff.
- When an agent asks a question, answer in the task Log (so it is durable) and in chat.

## 3. Review policy

| PR touches | Required approvals | Notes |
|---|---|---|
| Regular feature/bug in apps/packages | 1 human | Primary reviewer per task; the other may skim |
| `AGENTS.md`, `.agents/`, `.github/`, root tooling, `docs/adr/` | 2 humans | Protected (CODEOWNERS) |
| Billing / ledger / payments, auth / permissions / tenant isolation, migrations, AI prompts + model map, channel adapters | 2 humans, plan review first | Highest blast radius |
| Docs only | 1 human | Fast-track |

Review focus for humans (agents already ran lint/tests): **scope, correctness of business logic, guardrails, security, tests that actually test something, docs/tracking consistency**. Style is the linter's job — do not spend review time on it.

Reject patterns to watch for in agent PRs: silently widened scope, tests that assert the implementation rather than behavior, skipped/removed tests, `any`/`!` creeping in, copy-pasted logic across modules, queries without `workspace_id`, new dependencies without justification, "verified" claims without commands/results.

## 4. Communication and records

- **System of record**: GitHub (PRs, reviews) + repo files (`TODO.md`, `todo/`, `docs/`). If it is not written there, it did not happen.
- **Chat** (Zalo/Slack/…): for synchronous unblocking only; move outcomes into the task Log within the day.
- **Decisions**: product → `docs/14-open-decisions.md` or the task file; architecture → ADR; rules → PR to `.agents/rules/` with 2 approvals.
- Language: chat in Vietnamese is fine; everything written into the repo is English (Rule 01).

## 5. Keeping the product from eroding

- **Monthly guardrail audit** (agent task, `chore`): check module boundaries, `workspace_id` scoping, test coverage trend, docs drift vs code, dependency health, TODO hygiene. Output = backlog tasks.
- **Dependabot** PRs: merge weekly after CI; majors get a task.
- **AI evals** run on every prompt/model change; a monthly review of sampled production conversations (once live) feeds new eval cases.
- **Rules are living**: when an agent makes the same mistake twice, the fix is a rule or a lint, not a reminder in chat.
- **Metrics** reviewed monthly: PR cycle time (open → merge), % PRs needing a second round, CI failure rate on `main`, post-merge bugs per 10 PRs, open task age.

## 6. First two weeks (Phase 0) — concrete plan

| Day | thienlng | tungdd7 | Agents |
|---|---|---|---|
| 1 | Answer `docs/14-open-decisions.md` (T-002); invite the second maintainer; decide on GitHub Pro (branch protection for the private repo — until then the `pre-push` hook + `Main guard` workflow are the controls) | Clone, `bash scripts/verify-setup.sh`, review this framework, propose rule changes via PR | — |
| 2–3 | Start Meta Business Verification + Zalo developer app; brand/domain | Review and merge T-003/T-004 plans | T-003 (api skeleton), T-004 (db) plan-first, then implement |
| 4–7 | Interview 5 shops; collect real questions for evals | Review PRs; set up GitHub Environments/secrets for T-008 | T-005 (web shell), T-006 (test harness) |
| 8–10 | Groom MVP sprint 1 tasks from `docs/12-roadmap-and-plan.md` §4 | T-007 review (ai-core), T-008 | T-007, T-008 |
| Retro | 30 min: what slowed agents down? Update rules/skills. | | |

## 7. Onboarding a new human

1. Read `AGENTS.md` and `.agents/rules/` (same as agents), then this document.
2. `gh auth login`, clone, `bash scripts/verify-setup.sh`.
3. Get added to `.github/CODEOWNERS` via PR.
4. Shadow one review with an existing maintainer, then take primary reviewer on a docs-only or small PR.
