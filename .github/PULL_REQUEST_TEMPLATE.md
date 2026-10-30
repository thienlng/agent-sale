<!-- Title: <type>(<scope>): <subject>. One finished feature per PR. Rules: .agents/rules/02-git-and-pr.md -->

## Summary

What the feature does and why, 3–6 lines. Where to start reading. Link the docs/ADR sections it follows.

## Verification

Exact commands run and results (test counts, screenshots for UI, eval scores for AI changes):

```
pnpm check
```

## Checklist (author)

- [ ] Branch updated with `main`, conflicts resolved
- [ ] Tests added/updated; no test skipped/deleted; cross-tenant test for new endpoints
- [ ] `pnpm check` green locally; CI green
- [ ] Architecture guardrails respected (module boundaries, `workspace_id` scoping, ledger rule, backward-compatible migration); ADR added if required
- [ ] Docs updated (or no impact — say why)
- [ ] No secrets, no PII, no `console.log`; new dependencies justified
- [ ] English everywhere; user-facing strings in i18n files
