---
name: review-pr
description: Review a pull request against this repo's rules (scope, tests, architecture guardrails, security, docs, conflicts with main) and produce actionable findings. Use when asked to review a PR or before marking your own PR ready.
---

# Review a PR

Read the PR summary first, then the diff. Judge the PR against the feature it claims to deliver, not against what you would have built.

## Checklist

1. **Scope** — is it one complete feature? Unrelated changes → request split; partial features → request completion first.
2. **Correctness** — trace the main path and failure paths; look for off-by-one, null handling, race conditions (webhooks, queues), idempotency, timezone/money arithmetic.
3. **Tests** — new behavior has tests; bug fix has a regression test; new endpoint has permission + cross-tenant tests; tests are deterministic. Were any tests weakened?
4. **Architecture (Rule 05)** — module boundaries respected; no cross-module repository access; queries scoped by `workspace_id`; ledger rule; migration backward compatible; adapters used for third parties; prompts versioned with evals.
5. **Security (Rule 07)** — input validation, secrets, PII in logs/fixtures, webhook signature, new dependency justified.
6. **Docs (Rule 06)** — docs/ADR updated when needed; README for new package.
7. **Up to date (Rule 02)** — branch merged with current `main`, conflicts resolved keeping both sides' intent (check migrations numbering and merged schema/i18n files).
8. **Conventions (Rules 01, 02, 04)** — English, Conventional Commits, PR template filled, verification section is concrete, diff size.

## Output

Findings ordered by severity, each with file:line, what is wrong, why it matters, and a concrete fix. Distinguish **blocking** from **nit**. End with a one-line verdict: approve / request changes. Agents do not click approve; a human does.
