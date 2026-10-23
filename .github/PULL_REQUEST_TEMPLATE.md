<!-- Title: <type>(<scope>): <subject> (T-xxx). Rules: .agents/rules/02-git-and-pr.md -->

Closes T-xxx — [task file](todo/T-xxx-slug.md)

## Summary

What and why, 3–6 lines. Link the docs/ADR sections this follows.

## Changes

- `apps/api`: …
- `packages/…`: …
- `docs/`: …

## Verification

Exact commands run and results (test counts, screenshots for UI, eval scores for AI changes):

```
pnpm check
```

## Checklist (author)

- [ ] One task, in scope; follow-ups created as backlog tasks
- [ ] Tests added/updated; no test skipped/deleted; cross-tenant test for new endpoints
- [ ] `pnpm check` green locally; CI green
- [ ] Architecture guardrails respected (module boundaries, `workspace_id` scoping, ledger rule, backward-compatible migration); ADR added if required
- [ ] Docs updated (or no impact — say why)
- [ ] Task file updated (status, log, acceptance criteria) and `TODO.md` line updated
- [ ] No secrets, no PII, no `console.log`; new dependencies justified below
- [ ] English everywhere; user-facing strings in i18n files

New dependencies and why: none

## Follow-ups

- T-…

## Reviewer checklist

- [ ] Scope matches the task; diff size reasonable
- [ ] Correctness incl. failure paths, idempotency, money/time arithmetic
- [ ] Tests meaningful and deterministic; nothing weakened
- [ ] Guardrails (Rule 05) and security (Rule 07)
- [ ] Docs + tracking consistent with the change
