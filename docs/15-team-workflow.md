# 15 — Team workflow: two humans, many agents

> **Update 2026-10-23:** there is currently **one** human maintainer (`thienlng`), who holds both the product-owner and tech-lead roles. Wherever this document says "2 humans", read: maintainer approval **plus** a fresh-context agent review (`review-pr` skill, ideally from a different tool than the implementer) whose findings are posted on the PR. A second maintainer is added back to `.github/CODEOWNERS` when one joins.

> How the two human maintainers (`thienlng`, and a future second maintainer) run a product that is mostly written by coding agents. This complements the rules in `.agents/rules/` (which bind agents) with the operating model for humans. Revisit after the first month; adjust via PR.

## 1. Roles

| Role | Who | Owns |
|---|---|---|
| Product owner | `thienlng` | What gets built next, `docs/14-open-decisions.md`, product behavior, pricing, go/no-go for phases |
| Tech lead | `thienlng` (until a second maintainer joins) | Architecture guardrails (Rule 05), ADR acceptance, CI/infra/tooling, protected files, security review |
| Reviewer | both | Any PR. Each human is the **primary** reviewer for the areas above and **secondary** for the rest |
| Agent operator | both | Launching agents on features, answering their questions, keeping their sessions unblocked |

Either human can act in the other's role when needed; the table says who has the final word when they disagree. Record disagreements that matter in the PR or an ADR, not only in chat.

## 2. Operating loop

> **Simplified 2026-10-30 (start of version 2):** no task board or task files. Work starts from a human request; the PR is the record.

- **One feature → one branch → one PR.** An agent session builds the whole feature on its branch (commits in reviewable steps) and opens the PR only when the feature is complete. Use `git worktree` (or the tool's worktree mode) so several agents can run in parallel without interfering.
- **Before merging**, the branch is updated with `main` (merge, not rebase), conflicts are resolved keeping both sides' intent, `pnpm check` and CI are green. Then squash merge.
- Start every session with the `onboarding` skill. Larger features: the agent states a short plan to the human before coding.
- Mix tools deliberately: the agent that implements and the agent that pre-reviews (`review-pr`) should be different. Humans read the agent review first, then the diff.
- **Review SLA: 24 hours** for a ready PR. If CI is red on `main`, fixing it is the top priority for whoever sees it first.

## 3. Review policy

| PR touches | Required approvals | Notes |
|---|---|---|
| Regular feature/bug in apps/packages | 1 human | The other may skim |
| `AGENTS.md`, `.agents/`, `.github/`, root tooling, `docs/adr/` | 2 humans | Protected (CODEOWNERS) |
| Billing / ledger / payments, auth / permissions / tenant isolation, migrations, AI prompts + model map, channel adapters | 2 humans, plan review first | Highest blast radius |
| Docs only | 1 human | Fast-track |

Review focus for humans (agents already ran lint/tests): **scope, correctness of business logic, guardrails, security, tests that actually test something, docs consistency, conflicts resolved against current `main`**. Style is the linter's job — do not spend review time on it.

Reject patterns to watch for in agent PRs: silently widened scope, tests that assert the implementation rather than behavior, skipped/removed tests, `any`/`!` creeping in, copy-pasted logic across modules, queries without `workspace_id`, new dependencies without justification, "verified" claims without commands/results.

## 4. Communication and records

- **System of record**: GitHub (PRs, reviews) + `docs/`. If it is not written there, it did not happen.
- **Chat** (Zalo/Slack/…): for synchronous unblocking; move decisions that matter into the PR or `docs/`.
- **Decisions**: product → `docs/14-open-decisions.md`; architecture → ADR; rules → PR to `.agents/rules/` with 2 approvals.
- Language: chat in Vietnamese is fine; everything written into the repo is English (Rule 01).

## 5. Keeping the product from eroding

- **Monthly guardrail audit** (agent task, `chore`): check module boundaries, `workspace_id` scoping, test coverage trend, docs drift vs code, dependency health. Output = a short findings list for the maintainer.
- **Dependabot** PRs: merge weekly after CI; majors get a read of the release notes first.
- **AI evals** run on every prompt/model change; a monthly review of sampled production conversations (once live) feeds new eval cases.
- **Rules are living**: when an agent makes the same mistake twice, the fix is a rule or a lint, not a reminder in chat.
- **Metrics** reviewed monthly: PR cycle time (open → merge), % PRs needing a second round, CI failure rate on `main`, post-merge bugs per 10 PRs.

## 6. Onboarding a new human

1. Read `AGENTS.md` and `.agents/rules/` (same as agents), then this document.
2. `gh auth login`, clone, `bash scripts/verify-setup.sh`.
3. Get added to `.github/CODEOWNERS` via PR.
4. Shadow one review with an existing maintainer, then take primary reviewer on a docs-only or small PR.
